// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "@openzeppelin/contracts/utils/Create2.sol";
import "@account-abstraction/contracts/interfaces/IEntryPoint.sol";
import "./XAccount.sol";

/**
 * @title XFactory
 * @dev Factory for deploying XAccount smart wallets using CREATE2 for deterministic addresses.
 */
contract XFactory {
    XAccount public immutable accountImplementation;

    event AccountCreated(address indexed account, address indexed owner);

    constructor(IEntryPoint _entryPoint) {
        accountImplementation = new XAccount(_entryPoint);
    }

    /**
     * @dev Create an account, and return its address.
     * Returns the address even if the account is already deployed.
     * Note that during UserOperation execution, this method is called only if the account is not deployed.
     */
    function createAccount(address owner, uint256 salt) external returns (XAccount ret) {
        address addr = getAddress(owner, salt);
        uint256 codeSize = addr.code.length;
        if (codeSize > 0) {
            return XAccount(payable(addr));
        }

        bytes memory bytecode = _getBytecode(owner);
        bytes32 saltBytes = bytes32(salt);
        address proxy = Create2.deploy(0, saltBytes, bytecode);
        
        ret = XAccount(payable(proxy));
        emit AccountCreated(proxy, owner);
    }

    /**
     * @dev Calculate the counterfactual address of this account as it would be returned by createAccount()
     */
    function getAddress(address owner, uint256 salt) public view returns (address) {
        bytes memory bytecode = _getBytecode(owner);
        bytes32 saltBytes = bytes32(salt);
        return Create2.computeAddress(saltBytes, keccak256(bytecode));
    }

    function _getBytecode(address owner) internal view returns (bytes memory) {
        return abi.encodePacked(
            type(ERC1967Proxy).creationCode,
            abi.encode(
                address(accountImplementation),
                abi.encodeCall(XAccount.initialize, (owner))
            )
        );
    }
}
