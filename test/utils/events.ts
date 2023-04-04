import { ContractReceipt, ethers, Event } from "ethers";
import { Interface } from "ethers/lib/utils";

export function decodeEvent(tx: ContractReceipt, iface: Interface) {
  const event: Event = tx.events?.find((e: Event) => {
    let result = true;
    try {
      iface.parseLog(e);
    } catch (ex) {
      result = false;
    }
    return result;
  })!;

  return iface.parseLog(event);
}

export function parseEventFromABI(tx: ContractReceipt, abi: string[]) {
  const iface = new ethers.utils.Interface(abi);
  const event = decodeEvent(tx, iface);
  return event.args;
}
