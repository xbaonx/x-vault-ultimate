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

    // Security: Spending Limits
    uint256 public dailyLimit;
    mapping(uint256 => uint256) public dailySpent; // day => amount spent

    // Security: TimeLock for Critical Actions (Delay: 48 hours)
    uint256 public constant SECURITY_DELAY = 2 days;
    mapping(bytes32 => uint256) public timelockedActions; // actionHash => executableTimestamp

    event DeviceAdded(bytes32 indexed deviceIdHash);
    event DeviceRemoved(bytes32 indexed deviceIdHash);
    event SpendingLimitChanged(uint256 newLimit);
    event CriticalActionScheduled(bytes32 indexed actionHash, uint256 executableTime);
    event CriticalActionCancelled(bytes32 indexed actionHash);

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
        dailyLimit = 2000 * 10**18; // Default limit: 2000 "Units" (e.g., if USD peg used, otherwise ETH)
                                    // For ETH, this is huge, let's assume this is in WEI and we want 1 ETH limit by default for safety
        dailyLimit = 1 ether; 
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
     * @dev Internal function to enforce spending limits.
     */
    function _enforceLimits(uint256 value) internal {
        if (value > 0) {
            uint256 currentDay = block.timestamp / 1 days;
            uint256 spent = dailySpent[currentDay];
            require(spent + value <= dailyLimit, "XAccount: Daily spending limit exceeded");
            dailySpent[currentDay] = spent + value;
        }
    }

    /**
     * @dev Execute a transaction (called directly from entryPoint).
     */
    function execute(address dest, uint256 value, bytes calldata func) external {
        _requireFromEntryPoint();
        _enforceLimits(value);
        _call(dest, value, func);
    }

    /**
     * @dev Execute a sequence of transactions.
     */
    function executeBatch(address[] calldata dest, uint256[] calldata value, bytes[] calldata func) external {
        _requireFromEntryPoint();
        require(dest.length == value.length && value.length == func.length, "XAccount: length mismatch");
        
        uint256 totalValue = 0;
        for (uint256 i = 0; i < dest.length; i++) {
            totalValue += value[i];
            _call(dest[i], value[i], func[i]);
        }
        _enforceLimits(totalValue);
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
     * @dev Set daily spending limit.
     */
    function setDailyLimit(uint256 _newLimit) external onlyOwner {
        dailyLimit = _newLimit;
        emit SpendingLimitChanged(_newLimit);
    }

    /**
     * @dev Schedule a critical action (like upgrade).
     */
    function scheduleUpgrade(address newImplementation) external onlyOwner {
        bytes32 actionHash = keccak256(abi.encodePacked("UPGRADE", newImplementation));
        uint256 executableTime = block.timestamp + SECURITY_DELAY;
        timelockedActions[actionHash] = executableTime;
        emit CriticalActionScheduled(actionHash, executableTime);
    }

    /**
     * @dev Cancel a scheduled critical action.
     */
    function cancelUpgrade(address newImplementation) external onlyOwner {
        bytes32 actionHash = keccak256(abi.encodePacked("UPGRADE", newImplementation));
        delete timelockedActions[actionHash];
        emit CriticalActionCancelled(actionHash);
    }

    /**
     * @dev Implementation for UUPS upgradeability with TimeLock.
     */
    function _authorizeUpgrade(address newImplementation) internal view override onlyOwner {
        bytes32 actionHash = keccak256(abi.encodePacked("UPGRADE", newImplementation));
        require(timelockedActions[actionHash] != 0, "XAccount: Upgrade not scheduled");
        require(block.timestamp >= timelockedActions[actionHash], "XAccount: TimeLock active");
    }

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
