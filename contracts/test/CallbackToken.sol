// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract CallbackToken is ERC20 {
    address private target;
    bytes private payload;
    bool private armed;
    bool public attempted;
    bool public callbackSucceeded;
    bytes4 public callbackError;

    constructor() ERC20("Callback test token", "CALL") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function arm(address destination, bytes calldata data) external {
        target = destination;
        payload = data;
        armed = true;
        attempted = false;
    }

    function _update(address from, address to, uint256 amount) internal override {
        super._update(from, to, amount);
        if (armed) {
            armed = false;
            attempted = true;
            bytes memory reason;
            (callbackSucceeded, reason) = target.call(payload);
            callbackError = bytes4(reason);
        }
    }
}
