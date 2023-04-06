// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;

import "./ERC20PresetMinterPauser.sol";

contract SwapRouterMock {
    address public tokenIn;
    address public tokenOut;

    struct ExactInputParams {
        bytes path;
        address recipient;
        uint256 deadline;
        uint256 amountIn;
        uint256 amountOutMinimum;
    }

    event ExactInputCalledWith(uint256 amountIn, uint256 amountOutMinimum);

    constructor(address _tokenIn, address _tokenOut) {
        tokenIn = _tokenIn;
        tokenOut = _tokenOut;
    }

    function exactInput(ExactInputParams calldata params) external payable returns (uint256 amountOut) {
        amountOut = params.amountIn; // 1:1 swap

        ERC20PresetMinterPauser(tokenIn).transferFrom(msg.sender, address(this), params.amountIn);
        ERC20PresetMinterPauser(tokenOut).mint(msg.sender, amountOut);

        emit ExactInputCalledWith(params.amountIn, params.amountOutMinimum);
    }
}
