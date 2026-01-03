// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@account-abstraction/contracts/core/BasePaymaster.sol";
import "@account-abstraction/contracts/interfaces/UserOperation.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title XPaymaster
 * @dev Paymaster that uses an off-chain signer to authorize gas sponsorship.
 * This fits the X-Vault model where the backend decides to sponsor gas based on campaigns or fee credits.
 */
contract XPaymaster is BasePaymaster {
    using ECDSA for bytes32;
    using MessageHashUtils for bytes32;
    using UserOperationLib for UserOperation;

    address public verifyingSigner;
    uint256 public constant COST_OF_POST = 15000;

    mapping(address => uint256) public senderNonce;

    constructor(IEntryPoint _entryPoint, address _verifyingSigner) 
        BasePaymaster(_entryPoint) 
        Ownable(msg.sender)
    {
        verifyingSigner = _verifyingSigner;
    }

    function setVerifyingSigner(address _newSigner) external onlyOwner {
        verifyingSigner = _newSigner;
    }

    /**
     * @dev validate the request:
     * The paymasterAndData should contain the signature of the verifyingSigner.
     * The signature is over the hash of the UserOp (excluding the signature field itself),
     * combined with the validUntil and validAfter timestamps.
     */
    function _validatePaymasterUserOp(
        UserOperation calldata userOp,
        bytes32 userOpHash,
        uint256 requiredPreFund
    ) internal override returns (bytes memory context, uint256 validationData) {
        (requiredPreFund); // unused
        (userOpHash); // unused
        
        // verificationGasLimit is at least COST_OF_POST.
        // The paymasterAndData: [paymasterAddress (20 bytes)] [validUntil (6 bytes)] [validAfter (6 bytes)] [signature (dynamic)]
        // However, standard VerifyingPaymaster often structures it as:
        // [paymasterAddress] [validUntil (48 bits)] [validAfter (48 bits)] [signature]
        
        // We need at least 20 + 6 + 6 + 65 = 97 bytes for paymasterAndData
        // But let's stick to the standard decoding.

        // For MVP simplicity, we assume paymasterAndData contains just the signature after the address?
        // No, standard is usually: MOCK_VALID_UNTIL, MOCK_VALID_AFTER.
        
        // Let's parse paymasterAndData.
        // It starts with the paymaster address (20 bytes).
        // Then we define our custom encoding.
        // Let's say: [validUntil (uint48)] [validAfter (uint48)] [signature]
        
        if (userOp.paymasterAndData.length < 20 + 6 + 6 + 64) {
             // If no signature or time provided, reject.
             // Or we could have a mode where we accept everything if the sender is whitelisted?
             // For X-Vault, we want strict control.
             return ("", _packValidationData(true, 0, 0));
        }

        uint48 validUntil = uint48(bytes6(userOp.paymasterAndData[20:26]));
        uint48 validAfter = uint48(bytes6(userOp.paymasterAndData[26:32]));
        bytes memory signature = userOp.paymasterAndData[32:];

        require(signature.length == 64 || signature.length == 65, "XPaymaster: invalid signature length");

        // Verify signature
        // Hash: keccak256(userOpHash, validUntil, validAfter) (This is a simplified scheme)
        // Standard VerifyingPaymaster uses EIP-712 or specific packing.
        // We will use a simple hash for this implementation.
        
        bytes32 ethSignedHash = getHash(userOp, validUntil, validAfter).toEthSignedMessageHash();
        senderNonce[userOp.getSender()]++;

        if (ethSignedHash.recover(signature) != verifyingSigner) {
            // Signature mismatch
            return ("", _packValidationData(true, 0, 0));
        }

        // Return validation data with time range
        return ("", _packValidationData(false, validUntil, validAfter));
    }

    function pack(UserOperation calldata userOp) internal pure returns (bytes memory ret) {
        bytes calldata pnd = userOp.paymasterAndData;
        assembly {
            let ofs := userOp
            let len := sub(sub(pnd.offset, ofs), 32)
            ret := mload(0x40)
            mstore(0x40, add(ret, add(len, 32)))
            mstore(ret, len)
            calldatacopy(add(ret, 32), ofs, len)
        }
    }

    function getHash(UserOperation calldata userOp, uint48 validUntil, uint48 validAfter) public view returns (bytes32) {
        return keccak256(
            abi.encode(
                pack(userOp),
                block.chainid,
                address(this),
                senderNonce[userOp.getSender()],
                validUntil,
                validAfter
            )
        );
    }
}
