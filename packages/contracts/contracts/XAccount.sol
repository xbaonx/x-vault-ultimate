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
    address private immutable _p256Verifier;
    bytes32 private immutable _defaultRpIdHash;
    bool private immutable _defaultRequireUserVerification;
    
    // Device binding mapping: deviceIdHash => isActive
    mapping(bytes32 => bool) public activeDevices;

    // Security: Spending Limits & Freeze
    uint256 public dailyLimit;
    mapping(uint256 => uint256) public dailySpent; // day => amount spent
    bool public isFrozen;

    // Security: Delay policy (48h)
    uint256 public largeTxThresholdWei;
    mapping(address => uint256) public tokenDelayThreshold;

    struct PendingTx {
        address dest;
        uint256 value;
        bytes func;
        uint48 executeAfter;
        bool canceled;
        bool executed;
    }

    struct PendingBatchTx {
        address[] dest;
        uint256[] value;
        bytes[] func;
        uint48 executeAfter;
        bool canceled;
        bool executed;
    }

    mapping(bytes32 => PendingTx) public pendingTxs;
    uint256 public pendingTxNonce;

    mapping(bytes32 => PendingBatchTx) private pendingBatchTxs;
    uint256 public pendingBatchTxNonce;

    bytes32 public expectedRpIdHash;
    bool public requireUserVerification;

    event DeviceAdded(bytes32 indexed deviceIdHash);
    event DeviceRemoved(bytes32 indexed deviceIdHash);
    event SpendingLimitChanged(uint256 newLimit);
    event PublicKeyUpdated(uint256 x, uint256 y);
    event AccountFrozen(bool status);
    event LargeTxThresholdChanged(uint256 newThresholdWei);
    event TokenDelayThresholdChanged(address indexed token, uint256 newThreshold);
    event TransactionDelayed(bytes32 indexed txId, uint48 executeAfter, address indexed dest, uint256 value);
    event BatchTransactionDelayed(bytes32 indexed txId, uint48 executeAfter, uint256 count, uint256 totalValue);
    event BatchTransactionExecuted(bytes32 indexed txId);
    event BatchTransactionCancelled(bytes32 indexed txId);
    event TransactionExecuted(bytes32 indexed txId);
    event TransactionCancelled(bytes32 indexed txId);

    modifier onlyOwner() {
        _checkOwner();
        _;
    }

    modifier notFrozen() {
        require(!isFrozen, "XAccount: Account is frozen");
        _;
    }

    constructor(IEntryPoint anEntryPoint, address p256Verifier, bytes32 defaultRpIdHash, bool defaultRequireUserVerification) {
        _entryPoint = anEntryPoint;
        _p256Verifier = p256Verifier;
        _defaultRpIdHash = defaultRpIdHash;
        _defaultRequireUserVerification = defaultRequireUserVerification;
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
        requireUserVerification = _defaultRequireUserVerification;
        if (expectedRpIdHash == bytes32(0) && _defaultRpIdHash != bytes32(0)) {
            expectedRpIdHash = _defaultRpIdHash;
        }
        dailyLimit = 1000 ether; // Default limit (high for tokens, logic can be refined)
        largeTxThresholdWei = 0;
    }

    function setExpectedRpIdHash(bytes32 _expectedRpIdHash) external onlyOwner {
        expectedRpIdHash = _expectedRpIdHash;
    }

    function setRequireUserVerification(bool _requireUserVerification) external onlyOwner {
        requireUserVerification = _requireUserVerification;
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
        if (userOp.signature.length < 160) {
            return SIG_VALIDATION_FAILED;
        }

        uint256 r;
        uint256 s;
        bytes memory authenticatorData;
        bytes memory clientDataPrefix;
        bytes memory clientDataSuffix;
        try this._decodeWebAuthnSignature(userOp.signature) returns (
            uint256 _r,
            uint256 _s,
            bytes memory _authenticatorData,
            bytes memory _clientDataPrefix,
            bytes memory _clientDataSuffix
        ) {
            r = _r;
            s = _s;
            authenticatorData = _authenticatorData;
            clientDataPrefix = _clientDataPrefix;
            clientDataSuffix = _clientDataSuffix;
        } catch {
            return SIG_VALIDATION_FAILED;
        }

        if (authenticatorData.length < 37) {
            return SIG_VALIDATION_FAILED;
        }

        bytes32 rpIdHash;
        assembly {
            rpIdHash := mload(add(authenticatorData, 32))
        }
        if (expectedRpIdHash != bytes32(0) && rpIdHash != expectedRpIdHash) {
            return SIG_VALIDATION_FAILED;
        }

        uint8 flags = uint8(authenticatorData[32]);
        if ((flags & 0x01) == 0) {
            return SIG_VALIDATION_FAILED;
        }
        if (requireUserVerification && (flags & 0x04) == 0) {
            return SIG_VALIDATION_FAILED;
        }

        bytes memory challengeB64 = _base64UrlEncode32(userOpHash);
        bytes memory clientDataJSON = bytes.concat(clientDataPrefix, challengeB64, clientDataSuffix);

        bytes32 clientDataHash = sha256(clientDataJSON);
        bytes32 messageHash = sha256(abi.encodePacked(authenticatorData, clientDataHash));

        bytes memory input = abi.encodePacked(messageHash, r, s, publicKeyX, publicKeyY);
        
        (bool success, bytes memory ret) = _p256Verifier.staticcall(input);
        
        // Check if call succeeded and result is 1 (valid)
        if (!success || ret.length == 0 || uint256(bytes32(ret)) != 1) {
            return SIG_VALIDATION_FAILED;
        }

        return 0;
    }

    function _decodeWebAuthnSignature(bytes calldata sig)
        external
        pure
        returns (
            uint256 r,
            uint256 s,
            bytes memory authenticatorData,
            bytes memory clientDataPrefix,
            bytes memory clientDataSuffix
        )
    {
        return abi.decode(sig, (uint256, uint256, bytes, bytes, bytes));
    }

    /**
     * @dev Execute any transaction (Native ETH, ERC-20, NFT, Interaction...)
     * This supports "All Coins".
     */
    function execute(address dest, uint256 value, bytes calldata func) external notFrozen {
        _requireFromEntryPoint();
        if (_shouldDelay(dest, value, func)) {
            bytes32 txId = _enqueueDelayed(dest, value, func);
            emit TransactionDelayed(txId, pendingTxs[txId].executeAfter, dest, value);
            return;
        }
        _checkSpendingLimit(value);
        _call(dest, value, func);
    }

    /**
     * @dev Execute Batch (e.g. Approve + Swap)
     */
    function executeBatch(address[] calldata dest, uint256[] calldata value, bytes[] calldata func) external notFrozen {
        _requireFromEntryPoint();
        require(dest.length == value.length && value.length == func.length, "XAccount: length mismatch");

        uint256 totalValue = 0;
        bool shouldDelay = false;
        for (uint256 i = 0; i < dest.length; i++) {
            totalValue += value[i];
            if (_shouldDelay(dest[i], value[i], func[i])) {
                shouldDelay = true;
            }
        }

        if (shouldDelay) {
            bytes32 txId = _enqueueDelayedBatch(dest, value, func);
            emit BatchTransactionDelayed(txId, pendingBatchTxs[txId].executeAfter, dest.length, totalValue);
            return;
        }

        _checkSpendingLimit(totalValue);
        for (uint256 i = 0; i < dest.length; i++) {
            _call(dest[i], value[i], func[i]);
        }
    }

    function executeDelayed(bytes32 txId) external notFrozen {
        _requireFromEntryPoint();
        PendingTx storage p = pendingTxs[txId];
        require(p.executeAfter != 0, "XAccount: Unknown tx");
        require(!p.canceled, "XAccount: Cancelled");
        require(!p.executed, "XAccount: Executed");
        require(block.timestamp >= p.executeAfter, "XAccount: Security Delay active");

        p.executed = true;
        _checkSpendingLimit(p.value);
        _call(p.dest, p.value, p.func);
        emit TransactionExecuted(txId);
    }

    function executeDelayedDirect(bytes32 txId) external notFrozen {
        _requireFromEntryPoint();
        PendingTx storage p = pendingTxs[txId];
        require(p.executeAfter != 0, "XAccount: Unknown tx");
        require(!p.canceled, "XAccount: Cancelled");
        require(!p.executed, "XAccount: Executed");
        require(block.timestamp >= p.executeAfter, "XAccount: Security Delay active");

        p.executed = true;
        _checkSpendingLimit(p.value);
        _call(p.dest, p.value, p.func);
        emit TransactionExecuted(txId);
    }

    function cancelDelayed(bytes32 txId) external {
        PendingTx storage p = pendingTxs[txId];
        require(p.executeAfter != 0, "XAccount: Unknown tx");
        require(!p.canceled, "XAccount: Cancelled");
        require(!p.executed, "XAccount: Executed");

        require(msg.sender == address(_entryPoint) || msg.sender == address(this), "XAccount: caller is not EntryPoint or self");

        p.canceled = true;
        emit TransactionCancelled(txId);
    }

    function executeDelayedBatch(bytes32 txId) external notFrozen {
        _requireFromEntryPoint();
        PendingBatchTx storage p = pendingBatchTxs[txId];
        require(p.executeAfter != 0, "XAccount: Unknown tx");
        require(!p.canceled, "XAccount: Cancelled");
        require(!p.executed, "XAccount: Executed");
        require(block.timestamp >= p.executeAfter, "XAccount: Security Delay active");

        p.executed = true;

        uint256 totalValue = 0;
        for (uint256 i = 0; i < p.value.length; i++) {
            totalValue += p.value[i];
        }
        _checkSpendingLimit(totalValue);

        for (uint256 i = 0; i < p.dest.length; i++) {
            _call(p.dest[i], p.value[i], p.func[i]);
        }

        emit BatchTransactionExecuted(txId);
    }

    function executeDelayedBatchDirect(bytes32 txId) external notFrozen {
        _requireFromEntryPoint();
        PendingBatchTx storage p = pendingBatchTxs[txId];
        require(p.executeAfter != 0, "XAccount: Unknown tx");
        require(!p.canceled, "XAccount: Cancelled");
        require(!p.executed, "XAccount: Executed");
        require(block.timestamp >= p.executeAfter, "XAccount: Security Delay active");

        p.executed = true;

        uint256 totalValue = 0;
        for (uint256 i = 0; i < p.value.length; i++) {
            totalValue += p.value[i];
        }
        _checkSpendingLimit(totalValue);

        for (uint256 i = 0; i < p.dest.length; i++) {
            _call(p.dest[i], p.value[i], p.func[i]);
        }

        emit BatchTransactionExecuted(txId);
    }

    function cancelDelayedBatch(bytes32 txId) external {
        PendingBatchTx storage p = pendingBatchTxs[txId];
        require(p.executeAfter != 0, "XAccount: Unknown tx");
        require(!p.canceled, "XAccount: Cancelled");
        require(!p.executed, "XAccount: Executed");

        require(msg.sender == address(_entryPoint) || msg.sender == address(this), "XAccount: caller is not EntryPoint or self");

        p.canceled = true;
        emit BatchTransactionCancelled(txId);
    }

    function getPendingBatchTxMeta(bytes32 txId) external view returns (uint48 executeAfter, bool canceled, bool executed, uint256 length) {
        PendingBatchTx storage p = pendingBatchTxs[txId];
        return (p.executeAfter, p.canceled, p.executed, p.dest.length);
    }

    function getPendingBatchTxItem(bytes32 txId, uint256 index) external view returns (address dest, uint256 value, bytes memory func) {
        PendingBatchTx storage p = pendingBatchTxs[txId];
        require(index < p.dest.length, "XAccount: index out of bounds");
        return (p.dest[index], p.value[index], p.func[index]);
    }

    function _checkSpendingLimit(uint256 value) internal {
        if (value == 0) return;
        uint256 today = block.timestamp / 1 days;
        require(dailySpent[today] + value <= dailyLimit, "XAccount: Daily limit exceeded");
        dailySpent[today] += value;
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

    function setLargeTxThresholdWei(uint256 _newThresholdWei) external onlyOwner {
        largeTxThresholdWei = _newThresholdWei;
        emit LargeTxThresholdChanged(_newThresholdWei);
    }

    function setTokenDelayThreshold(address token, uint256 thresholdAmount) external onlyOwner {
        tokenDelayThreshold[token] = thresholdAmount;
        emit TokenDelayThresholdChanged(token, thresholdAmount);
    }

    function toggleFreeze() external onlyOwner {
        isFrozen = !isFrozen;
        emit AccountFrozen(isFrozen);
    }

    // Security: TimeLock for Sensitive Operations
    uint256 public constant SECURITY_DELAY = 2 days;
    
    struct PendingKeyUpdate {
        uint256 x;
        uint256 y;
        uint256 effectiveTime;
    }
    PendingKeyUpdate public pendingKeyUpdate;

    event KeyUpdateRequested(uint256 x, uint256 y, uint256 effectiveTime);
    event KeyUpdateFinalized(uint256 x, uint256 y);

    // ... existing code ...

    function requestUpdatePublicKey(uint256 _newX, uint256 _newY) external onlyOwner {
        pendingKeyUpdate = PendingKeyUpdate({
            x: _newX,
            y: _newY,
            effectiveTime: block.timestamp + SECURITY_DELAY
        });
        emit KeyUpdateRequested(_newX, _newY, block.timestamp + SECURITY_DELAY);
    }

    function finalizeUpdatePublicKey() external {
        // Can be triggered by anyone/bundler as long as time has passed and request is valid
        require(pendingKeyUpdate.effectiveTime != 0, "XAccount: No pending key update");
        require(block.timestamp >= pendingKeyUpdate.effectiveTime, "XAccount: Security Delay active");
        
        publicKeyX = pendingKeyUpdate.x;
        publicKeyY = pendingKeyUpdate.y;
        
        emit PublicKeyUpdated(pendingKeyUpdate.x, pendingKeyUpdate.y);
        emit KeyUpdateFinalized(pendingKeyUpdate.x, pendingKeyUpdate.y);
        
        delete pendingKeyUpdate;
    }

    // Deprecated immediate update - removed for V4.0 compliance
    // function updatePublicKey(...) external onlyOwner { ... }

    function _authorizeUpgrade(address newImplementation) internal view override onlyOwner {
        // Add TimeLock logic here if needed, simplified for P-256 upgrade demo
    }

    function _enqueueDelayed(address dest, uint256 value, bytes calldata func) internal returns (bytes32 txId) {
        pendingTxNonce += 1;
        txId = keccak256(abi.encodePacked(address(this), pendingTxNonce, dest, value, keccak256(func)));

        PendingTx storage p = pendingTxs[txId];
        p.dest = dest;
        p.value = value;
        p.func = func;
        p.executeAfter = uint48(block.timestamp + SECURITY_DELAY);
        p.canceled = false;
        p.executed = false;
    }

    function _enqueueDelayedBatch(address[] calldata dest, uint256[] calldata value, bytes[] calldata func) internal returns (bytes32 txId) {
        pendingBatchTxNonce += 1;
        txId = keccak256(abi.encodePacked(address(this), pendingBatchTxNonce, dest.length, keccak256(abi.encode(dest, value, func))));

        PendingBatchTx storage p = pendingBatchTxs[txId];
        delete p.dest;
        delete p.value;
        delete p.func;

        for (uint256 i = 0; i < dest.length; i++) {
            p.dest.push(dest[i]);
            p.value.push(value[i]);
            p.func.push(func[i]);
        }
        p.executeAfter = uint48(block.timestamp + SECURITY_DELAY);
        p.canceled = false;
        p.executed = false;
    }

    function _shouldDelay(address dest, uint256 value, bytes calldata func) internal view returns (bool) {
        if (largeTxThresholdWei > 0 && value >= largeTxThresholdWei) {
            return true;
        }

        uint256 tokenThreshold = tokenDelayThreshold[dest];
        if (tokenThreshold > 0 && value == 0 && func.length >= 4) {
            bytes4 selector;
            assembly {
                selector := calldataload(func.offset)
            }
            if (selector == bytes4(0xa9059cbb)) {
                (, uint256 amount) = abi.decode(func[4:], (address, uint256));
                if (amount >= tokenThreshold) {
                    return true;
                }
            }
        }
        return false;
    }

    function _base64UrlEncode32(bytes32 data) internal pure returns (bytes memory) {
        bytes memory TABLE = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
        bytes memory out = new bytes(43);
        uint256 i = 0;
        uint256 o = 0;
        while (i + 3 <= 32) {
            uint256 a = uint8(data[i]);
            uint256 b = uint8(data[i + 1]);
            uint256 c = uint8(data[i + 2]);

            uint256 n = (a << 16) | (b << 8) | c;
            out[o] = TABLE[(n >> 18) & 63];
            out[o + 1] = TABLE[(n >> 12) & 63];
            out[o + 2] = TABLE[(n >> 6) & 63];
            out[o + 3] = TABLE[n & 63];

            i += 3;
            o += 4;
        }

        {
            uint256 a2 = uint8(data[30]);
            uint256 b2 = uint8(data[31]);
            uint256 n2 = (a2 << 16) | (b2 << 8);
            out[40] = TABLE[(n2 >> 18) & 63];
            out[41] = TABLE[(n2 >> 12) & 63];
            out[42] = TABLE[(n2 >> 6) & 63];
        }

        return out;
    }

    receive() external payable {}
}
