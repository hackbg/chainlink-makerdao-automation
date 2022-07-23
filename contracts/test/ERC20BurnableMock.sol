// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";

contract ERC20BurnableMock is ERC20Burnable {
    constructor(string memory _name, string memory _symbol)
        ERC20(_name, _symbol)
    {}

    function burn(address _sender, uint256 _amount) public {
        burnFrom(_sender, _amount);
    }
}