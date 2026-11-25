// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract FeeToken is ERC20 {
    bool public chargeFee;

    constructor() ERC20("Fee test token", "FEE") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function enableFee() external {
        chargeFee = true;
    }

    function _update(address from, address to, uint256 amount) internal override {
        if (chargeFee && from != address(0) && to != address(0) && amount > 1) {
            super._update(from, address(0), 1);
            amount -= 1;
        }
        super._update(from, to, amount);
    }
}
