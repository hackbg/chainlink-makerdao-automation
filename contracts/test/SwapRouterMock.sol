// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;

contract SwapRouterMock {
    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        address recipient;
        uint256 deadline;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }

    event ExactInputSingleCalledWith(
        uint256 amountIn,
        uint256 amountOutMinimum
    );

    function exactInputSingle(ExactInputSingleParams calldata params)
        external
        payable
        returns (uint256 amountOut)
    {
        emit ExactInputSingleCalledWith(
            params.amountIn,
            params.amountOutMinimum
        );
        amountOut = params.amountIn;
    }
}
