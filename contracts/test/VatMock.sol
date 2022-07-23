// SPDX-License-Identifier: MIT
pragma solidity 0.8.9;

contract VatMock {
    mapping (address => uint256) public dai;

    function move(address src, address dst, uint256 rad) external {
        dai[src] = sub(dai[src], rad);
        dai[dst] = add(dai[dst], rad);
    }
    
    // --- Math ---
    function add(uint x, uint y) internal pure returns (uint z) {
        require((z = x + y) >= x);
    }
    function sub(uint x, uint y) internal pure returns (uint z) {
        require((z = x - y) <= x);
    }
}
