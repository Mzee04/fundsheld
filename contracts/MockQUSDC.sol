// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockQUSDC is ERC20 {
    error UnsupportedChain();

    constructor() ERC20("Mock QUSDC", "mQUSDC") {
        if (block.chainid != 1983 && block.chainid != 31337) revert UnsupportedChain();
    }

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
