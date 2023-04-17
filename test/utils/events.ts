import { ContractReceipt, ethers, Event } from "ethers";
import { Interface } from "ethers/lib/utils";

export function decodeEvent(
  tx: ContractReceipt,
  iface: Interface
): ethers.utils.LogDescription {
  if (!tx.events) {
    throw new Error("No events in this tx");
  }

  const event = tx.events.find((e: Event) => {
    let result = true;
    try {
      iface.parseLog(e);
    } catch (ex) {
      result = false;
    }
    return result;
  });

  if (!event) {
    throw new Error("No such event");
  }

  return iface.parseLog(event);
}

export function parseEventFromABI(
  tx: ContractReceipt,
  abi: string[]
): ethers.utils.Result {
  const iface = new ethers.utils.Interface(abi);
  const event = decodeEvent(tx, iface);
  return event.args;
}
