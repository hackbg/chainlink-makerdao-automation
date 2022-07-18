// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

interface IERC677 is IERC20 {
    function transferAndCall(
        address to,
        uint256 value,
        bytes memory data
    ) external returns (bool success);

    event Transfer(
        address indexed from,
        address indexed to,
        uint256 value,
        bytes data
    );
}

contract LinkTokenMock is ERC20, IERC677 {
    constructor() ERC20("Chainlink Mock", "LINK") {}

    function transferAndCall(
        address to,
        uint256 value,
        bytes memory data
    ) external returns (bool success) {}
}
