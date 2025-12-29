// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@account-abstraction/contracts/core/BaseAccount.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts/proxy/utils/UUPSUpgradeable.sol";

/**
 * @title XAccount
 * @dev Smart Account for X-Vault with Native Passkey Support (RIP-7212).
 * Supports generic ERC-20/NFT interactions.
 */
contract XAccount is BaseAccount, Initializable, UUPSUpgradeable {
    using MessageHashUtils for bytes32;

    // Owner is now a P-256 Public Key (X, Y coordinate)
    uint256 public publicKeyX;
    uint256 public publicKeyY;
    
    IEntryPoint private immutable _entryPoint;
    
    // Device binding mapping: deviceIdHash => isActive
    mapping(bytes32 => bool) public activeDevices;

    // Security: Spending Limits
    uint256 public dailyLimit;
    mapping(uint256 => uint256) public dailySpent; // day => amount spent

    event DeviceAdded(bytes32 indexed deviceIdHash);
    event DeviceRemoved(bytes32 indexed deviceIdHash);
    event SpendingLimitChanged(uint256 newLimit);
    event PublicKeyUpdated(uint256 x, uint256 y);

    // RIP-7212 Precompile Address
    address constant P256_VERIFIER = address(0x100);

    modifier onlyOwner() {
        _checkOwner();
        _;
    }

    constructor(IEntryPoint anEntryPoint) {
        _entryPoint = anEntryPoint;
        _disableInitializers();
    }

    function _checkOwner() internal view virtual {
        // In this model, "msg.sender == owner" doesn't apply directly for EOAs 
        // because the owner is a Passkey (not an address).
        // Only the EntryPoint or the account itself (self-call) can act as "owner" 
        // after verifying the signature in validation phase.
        require(msg.sender == address(_entryPoint) || msg.sender == address(this), "XAccount: caller is not EntryPoint or self");
    }

    /**
     * @dev Initialize with P-256 Public Key
     */
    function initialize(uint256 _publicKeyX, uint256 _publicKeyY) public virtual initializer {
        publicKeyX = _publicKeyX;
        publicKeyY = _publicKeyY;
        dailyLimit = 1000 ether; // Default limit (high for tokens, logic can be refined)
    }

    function entryPoint() public view virtual override returns (IEntryPoint) {
        return _entryPoint;
    }

    /**
     * @dev Verify P-256 Signature using RIP-7212 Precompile (Base Network).
     * userOp.signature is expected to be: abi.encode(r, s, authenticatorData, clientDataJSON_pre, clientDataJSON_post)
     * OR for MVP simplicity: abi.encode(r, s) assuming direct signing of the hash (if using custom client).
     * 
     * For full WebAuthn compliance:
     * 1. Reconstruct clientDataJSON = pre + base64url(userOpHash) + post
     * 2. message = sha256(authData + sha256(clientDataJSON))
     * 3. Verify(message, r, s, pubKey)
     */
    function _validateSignature(UserOperation calldata userOp, bytes32 userOpHash)
        internal
        view
        virtual
        override
        returns (uint256 validationData)
    {
        // Decode signature. Format: R (32), S (32)
        // Note: In production, we need full WebAuthn data structure verification.
        // For this MVP step, we assume the signature is (r, s) over the userOpHash directly
        // or the userOpHash is passed as the message.
        
        // Let's assume input is 64 bytes (r, s)
        if (userOp.signature.length < 64) {
            return SIG_VALIDATION_FAILED;
        }

        (uint256 r, uint256 s) = abi.decode(userOp.signature, (uint256, uint256));
        
        // Call Precompile 0x100
        // Input: hash (32), r (32), s (32), x (32), y (32)
        bytes memory input = abi.encodePacked(userOpHash, r, s, publicKeyX, publicKeyY);
        
        (bool success, bytes memory ret) = P256_VERIFIER.staticcall(input);
        
        // Check if call succeeded and result is 1 (valid)
        if (!success || ret.length == 0 || uint256(bytes32(ret)) != 1) {
            return SIG_VALIDATION_FAILED;
        }

        return 0;
    }

    /**
     * @dev Execute any transaction (Native ETH, ERC-20, NFT, Interaction...)
     * This supports "All Coins".
     */
    function execute(address dest, uint256 value, bytes calldata func) external {
        _requireFromEntryPoint();
        _call(dest, value, func);
    }

    /**
     * @dev Execute Batch (e.g. Approve + Swap)
     */
    function executeBatch(address[] calldata dest, uint256[] calldata value, bytes[] calldata func) external {
        _requireFromEntryPoint();
        require(dest.length == value.length && value.length == func.length, "XAccount: length mismatch");
        
        for (uint256 i = 0; i < dest.length; i++) {
            _call(dest[i], value[i], func[i]);
        }
    }

    function _call(address target, uint256 value, bytes memory data) internal {
        (bool success, bytes memory result) = target.call{value: value}(data);
        if (!success) {
            assembly {
                revert(add(result, 32), mload(result))
            }
        }
    }

    // --- Admin / Self-Management ---

    function setDailyLimit(uint256 _newLimit) external onlyOwner {
        dailyLimit = _newLimit;
        emit SpendingLimitChanged(_newLimit);
    }

    function updatePublicKey(uint256 _newX, uint256 _newY) external onlyOwner {
        publicKeyX = _newX;
        publicKeyY = _newY;
        emit PublicKeyUpdated(_newX, _newY);
    }

    function _authorizeUpgrade(address newImplementation) internal view override onlyOwner {
        // Add TimeLock logic here if needed, simplified for P-256 upgrade demo
    }

    receive() external payable {}
}
