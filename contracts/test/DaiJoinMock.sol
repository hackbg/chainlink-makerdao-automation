// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;

import "./LinkTokenMock.sol";
import "./VatMock.sol";
import "./ERC20BurnableMock.sol";
interface DSTokenLike {
    function mint(address,uint) external;
    function burn(address,uint) external;
}

contract DaiJoinMock {
    event Join(address usr, uint256 wad);
    VatMock vat;
    ERC20BurnableMock dai;
    constructor(address _vat, address _dai){
        vat = VatMock(_vat);
        dai = ERC20BurnableMock(_dai);
    }

    function join(address usr, uint256 wad) external {
        vat.move(address(this), usr, wad);
        dai.burn(msg.sender, wad);
    }
}
