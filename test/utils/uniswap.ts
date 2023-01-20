/* eslint-disable new-cap */
// uses both bn and BigNumber because BigNumber doesnt have sqrt function
import bn from "bignumber.js";
import { BigNumber } from "ethers";
bn.config({ EXPONENTIAL_AT: 999999, DECIMAL_PLACES: 40 });

export function encodePriceSqrt(
  reserve1: BigNumber,
  reserve0: BigNumber
): BigNumber {
  return BigNumber.from(
    new bn(reserve1.toString())
      .div(reserve0.toString())
      .sqrt()
      .multipliedBy(new bn(2).pow(96))
      .integerValue(3)
      .toString()
  );
}
