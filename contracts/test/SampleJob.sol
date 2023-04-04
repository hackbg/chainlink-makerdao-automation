// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;

import "../../vendor/dss-cron/src/base/TimedJob.sol";

// solhint-disable no-empty-blocks
contract SampleJob is TimedJob {
    constructor(address _sequencer, uint256 _maxDuration) TimedJob(_sequencer, _maxDuration) {}

    function update() internal override {}

    function shouldUpdate() internal pure override returns (bool) {
        return true;
    }
}
