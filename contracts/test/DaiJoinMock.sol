// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;

interface ERC20Like{
    function transferFrom(
        address from,
        address to, 
        uint256 amount
    ) external;
}

contract DaiJoinMock {
    ERC20Like paymentToken;

    constructor(address _paymentToken){
        paymentToken = ERC20Like(_paymentToken);
    }

    function join(address usr, uint256 wad) external {
        paymentToken.transferFrom(msg.sender, usr, wad);
    }
}
