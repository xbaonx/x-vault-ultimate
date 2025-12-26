// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@account-abstraction/contracts/core/BaseAccount.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts/proxy/utils/UUPSUpgradeable.sol";

/**
 * @title XAccount
 * @dev Smart Account implementation for X-Vault using ERC-4337.
 * Supports P-256 signature validation (simulated for now with ECDSA for MVP) and device binding.
 */
contract XAccount is BaseAccount, Initializable, UUPSUpgradeable {
    using ECDSA for bytes32;
    using MessageHashUtils for bytes32;

    address public owner;
    IEntryPoint private immutable _entryPoint;
    
    // Device binding mapping: deviceIdHash => isActive
    mapping(bytes32 => bool) public activeDevices;

    event DeviceAdded(bytes32 indexed deviceIdHash);
    event DeviceRemoved(bytes32 indexed deviceIdHash);

    modifier onlyOwner() {
        _checkOwner();
        _;
    }

    constructor(IEntryPoint anEntryPoint) {
        _entryPoint = anEntryPoint;
        _disableInitializers();
    }

    function _checkOwner() internal view virtual {
        require(msg.sender == owner || msg.sender == address(this), "XAccount: caller is not owner or self");
    }

    function initialize(address _owner) public virtual initializer {
        _entryPoint; // access to immutable to prevent unused warning if any
        owner = _owner;
    }

    /**
     * @dev Implementation of the entryPoint method from BaseAccount.
     */
    function entryPoint() public view virtual override returns (IEntryPoint) {
        return _entryPoint;
    }

    /**
     * @dev Validates the signature of a user operation.
     * In a full implementation, this would use P-256/WebAuthn verification.
     * For MVP/Simulation, we use standard ECDSA.
     */
    function _validateSignature(UserOperation calldata userOp, bytes32 userOpHash)
        internal
        view
        virtual
        override
        returns (uint256 validationData)
    {
        bytes32 hash = userOpHash.toEthSignedMessageHash();
        address signer = hash.recover(userOp.signature);
        
        if (signer != owner) {
            return SIG_VALIDATION_FAILED;
        }
        return 0;
    }

    /**
     * @dev Execute a transaction (called directly from entryPoint).
     */
    function execute(address dest, uint256 value, bytes calldata func) external {
        _requireFromEntryPoint();
        _call(dest, value, func);
    }

    /**
     * @dev Execute a sequence of transactions.
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

    /**
     * @dev Implementation for UUPS upgradeability.
     */
    function _authorizeUpgrade(address newImplementation) internal view override onlyOwner {}

    /**
     * @dev Add a device binding (hash of device ID).
     */
    function addDevice(bytes32 deviceIdHash) external onlyOwner {
        activeDevices[deviceIdHash] = true;
        emit DeviceAdded(deviceIdHash);
    }

    /**
     * @dev Remove a device binding.
     */
    function removeDevice(bytes32 deviceIdHash) external onlyOwner {
        activeDevices[deviceIdHash] = false;
        emit DeviceRemoved(deviceIdHash);
    }

    receive() external payable {}
}
