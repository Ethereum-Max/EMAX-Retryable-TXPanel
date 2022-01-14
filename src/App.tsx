import "./App.css";
import React from "react";
// import { BridgeHelper } from "arb-ts";
import {
  L1ToL2MessageReader,
  L1TransactionReceipt,
  L1ToL2MessageStatus
} from "arb-ts/dist/lib/message/L1ToL2Message";
import { getRawArbTransactionReceipt } from "arb-ts/dist/lib/utils/lib";

import {
  L1Network,
  getL2Network,
  getL1Network
} from "arb-ts/dist/lib/utils/networks";
import { JsonRpcProvider, Provider } from "@ethersproject/providers";
import { BigNumber } from "@ethersproject/bignumber";
import { toUtf8String } from "ethers/lib/utils";
import Redeem from "./Redeem";

export enum L1ReceiptState {
  EMPTY,
  LOADING,
  INVALID_INPUT_LENGTH,
  NOT_FOUND,
  FAILED,
  NO_L1_L2_MESSAGES,
  MESSAGES_FOUND
}

export enum AlertLevel {
  RED,
  YELLOW,
  GREEN,
  NONE
}

const receiptStateToDisplayableResult = (
  l1ReceiptState: L1ReceiptState
): {
  text: string;
  alertLevel: AlertLevel;
} => {
  switch (l1ReceiptState) {
    case L1ReceiptState.EMPTY:
      return {
        text: "",
        alertLevel: AlertLevel.NONE
      };
    case L1ReceiptState.LOADING:
      return {
        text: "Loading...",
        alertLevel: AlertLevel.NONE
      };
    case L1ReceiptState.INVALID_INPUT_LENGTH:
      return {
        text: "Error: invalid transction hash",
        alertLevel: AlertLevel.RED
      };
    case L1ReceiptState.NOT_FOUND:
      return {
        text: "L1 transaction not found",
        alertLevel: AlertLevel.YELLOW
      };
    case L1ReceiptState.FAILED:
      return {
        text: "Error: L1 transaction reverted",
        alertLevel: AlertLevel.RED
      };
    case L1ReceiptState.NO_L1_L2_MESSAGES:
      return {
        text: "No L1-to-L2 messages created by provided L1 transaction",
        alertLevel: AlertLevel.YELLOW
      };
    case L1ReceiptState.MESSAGES_FOUND:
      return {
        text: "L1 to L2 messages found",
        alertLevel: AlertLevel.GREEN
      };
  }
};

export interface L1ToL2MessageStatusDisplay {
  text: string;
  alertLevel: AlertLevel;
  showRedeemButton: boolean;
  retryableCreationId: string;
  autoRedeemId: string;
  l2TxHash: string;
  explorerUrl: string;
}

export enum Status {
  CREATION_FAILURE,
  NOT_FOUND,
  REEXECUTABLE,
  SUCCEEDED
}

export interface Result {
  status: Status;
  text: string;
}

export interface RetryableTxs {
  l1BlockExplorerUrl: string;
  l2BlockExplorerUrl: string;
  l1Tx?: string;
  l2Tx?: string;
  autoRedeem?: string;
  ticket?: string;
  result: Result;
  l2ChainId: number;
}

if (!process.env.REACT_APP_INFURA_KEY)
  throw new Error("No REACT_APP_INFURA_KEY set");

const supportedL1Networks = {
  "1": `https://mainnet.infura.io/v3/${process.env.REACT_APP_INFURA_KEY}`,
  "4": `https://rinkeby.infura.io/v3/${process.env.REACT_APP_INFURA_KEY}`
};

const getL1TxnReceipt = async (txnHash: string) => {
  for (let [chainID, rpcURL] of Object.entries(supportedL1Networks)) {
    const l1Network = await getL1Network(chainID);
    const l1Provider = await new JsonRpcProvider(rpcURL);

    const rec = await l1Provider.getTransactionReceipt(txnHash);
    if (rec) {
      return {
        l1TxnReceipt: new L1TransactionReceipt(rec),
        l1Network,
        l1Provider
      };
    }
  }
};

const getL1ToL2Messages = async (
  l1TxnReceipt: L1TransactionReceipt,
  l1Network: L1Network
) => {
  let allL1ToL2Messages: L1ToL2MessageReader[] = [];

  for (let l2ChainID of l1Network.partnerChainIDs) {
    // TODO: error handlle
    const l2Network = await getL2Network(l2ChainID);
    const l2Provider = new JsonRpcProvider(l2Network.rpcURL);
    const l1ToL2Messages = await l1TxnReceipt.getL1ToL2Messages(l2Provider);
    allL1ToL2Messages = allL1ToL2Messages.concat(l1ToL2Messages);
  }
  return allL1ToL2Messages;
};

const l1ToL2MessageToStatusDisplay = async (
  l1ToL2Message: L1ToL2MessageReader,
  looksLikeEthDeposit: boolean
): Promise<L1ToL2MessageStatusDisplay> => {
  const { retryableCreationId, autoRedeemId, l2TxHash } = l1ToL2Message;
  const messageStatus = await l1ToL2Message.status();
  const { explorerUrl } = await getL2Network(l1ToL2Message.l2Provider);
  switch (messageStatus) {
    case L1ToL2MessageStatus.CREATION_FAILED:
      return {
        text:
          "L2 message creation reverted; perhaps provided maxSubmissionCost was too low?",
        alertLevel: AlertLevel.RED,
        showRedeemButton: false,
        retryableCreationId,
        autoRedeemId,
        l2TxHash,
        explorerUrl
      };
    case L1ToL2MessageStatus.EXPIRED: {
      return {
        text: "Retryable ticket expired.",
        alertLevel: AlertLevel.RED,
        showRedeemButton: false,
        retryableCreationId,
        autoRedeemId,
        l2TxHash,
        explorerUrl
      };
    }
    case L1ToL2MessageStatus.NOT_YET_CREATED: {
      return {
        text:
          "L1 to L2 message initiated from L1, but not yet created — check again in a few minutes!",
        alertLevel: AlertLevel.YELLOW,
        showRedeemButton: false,
        retryableCreationId,
        autoRedeemId,
        l2TxHash,
        explorerUrl
      };
    }

    case L1ToL2MessageStatus.REDEEMED: {
      const autoRedeemReceipt = await l1ToL2Message.getAutoRedeemReceipt();

      const text =
        autoRedeemReceipt && autoRedeemReceipt.status === 1
          ? "Success! 🎉 Your retryable was auto-executed."
          : "Success! 🎉 Your retryable ticket has been executed directly on L2.";
      return {
        text: text,
        alertLevel: AlertLevel.GREEN,
        showRedeemButton: false,
        retryableCreationId,
        autoRedeemId,
        l2TxHash,
        explorerUrl
      };
    }
    case L1ToL2MessageStatus.NOT_YET_REDEEMED: {
      if (looksLikeEthDeposit) {
        return {
          text: "Success! 🎉 Your Eth deposit has completed",
          alertLevel: AlertLevel.GREEN,
          showRedeemButton: false,
          retryableCreationId,
          autoRedeemId,
          l2TxHash,
          explorerUrl
        };
      }

      const l2Provider = l1ToL2Message.l2Provider as JsonRpcProvider;
      const autoRedeemRec = await getRawArbTransactionReceipt(
        l2Provider,
        l1ToL2Message.autoRedeemId
      );

      // sanity check; should never occur
      if (autoRedeemRec && autoRedeemRec.status === "0x1") {
        return {
          text:
            "WARNING: auto-redeem succeeded, but transaction not executed..??? Contact support",
          alertLevel: AlertLevel.RED,
          showRedeemButton: false,
          retryableCreationId,
          autoRedeemId,
          l2TxHash,
          explorerUrl
        };
      }

      const text = (() => {
        if (!autoRedeemRec) {
          return "Auto-redeem not attempted; you can redeem it now:";
        }
        switch (BigNumber.from(autoRedeemRec.returnCode).toNumber()) {
          case 1:
            return `Your auto redeem reverted. The revert reason is: ${toUtf8String(
              `0x${autoRedeemRec.returnData.substr(10)}. You can redeem it now:`
            )}`;

          case 2:
            return "Auto redeem failed; hit congestion in the chain; you can redeem it now:";
          case 8:
            return "auto redeem _TxResultCode_exceededTxGasLimit; you can redeem it now:";
          case 10:
            return "auto redeem TxResultCode_belowMinimumTxGas; you can redeem it now:";
          case 11:
            return "auto redeem TxResultCode_gasPriceTooLow; you can redeem it now:";
          case 12:
            return "auto redeem TxResultCode_noGasForAutoRedeem; you can redeem it now:";
          default:
            return "auto redeem reverted; you can redeem it now:";
        }
      })();
      return {
        text,
        alertLevel: AlertLevel.YELLOW,
        showRedeemButton: true,
        retryableCreationId,
        autoRedeemId,
        l2TxHash,
        explorerUrl
      };
    }

    default:
      throw new Error("Uncaught L1ToL2MessageStatus type in switch statemmtn");
  }
};

function App() {
  const [input, setInput] = React.useState<string>("");
  const [l1TxnHashState, setL1TxnHashState] = React.useState<L1ReceiptState>(
    L1ReceiptState.EMPTY
  );
  const [l1ToL2MessagesDisplays, setl1ToL2MessagesDisplays] = React.useState<
    L1ToL2MessageStatusDisplay[]
  >([]);

  const retryablesSearch = async (txHash: string) => {
    setl1ToL2MessagesDisplays([]);
    setL1TxnHashState(L1ReceiptState.LOADING);

    if (txHash.length !== 66) {
      return setL1TxnHashState(L1ReceiptState.INVALID_INPUT_LENGTH);
    }
    const receiptRes = await getL1TxnReceipt(txHash);
    if (receiptRes === undefined) {
      return setL1TxnHashState(L1ReceiptState.NOT_FOUND);
    }
    const { l1Network, l1TxnReceipt, l1Provider } = receiptRes;
    if (l1TxnReceipt.status === 0) {
      return setL1TxnHashState(L1ReceiptState.FAILED);
    }

    const l1ToL2Messages = await getL1ToL2Messages(l1TxnReceipt, l1Network);
    if (l1ToL2Messages.length === 0) {
      return setL1TxnHashState(L1ReceiptState.NO_L1_L2_MESSAGES);
    }

    setL1TxnHashState(L1ReceiptState.MESSAGES_FOUND);

    const looksLikeEthDeposit = await l1TxnReceipt.looksLikeEthDeposit(
      l1Provider
    );

    const l1ToL2MessageStatuses: L1ToL2MessageStatusDisplay[] = [];
    for (let l1ToL2Message of l1ToL2Messages) {
      const l1ToL2MessageStatus = await l1ToL2MessageToStatusDisplay(
        l1ToL2Message,
        looksLikeEthDeposit
      );
      l1ToL2MessageStatuses.push(l1ToL2MessageStatus);
    }
    setl1ToL2MessagesDisplays(l1ToL2MessageStatuses);
  };

  const handleChange = (event: any) => {
    setInput(event.target.value);
  };
  const handleSubmit = (event: any) => {
    event.preventDefault();
    retryablesSearch(input);
  };

  const {
    text: l1TxnResultText,
    alertLevel: l1TxnResultLevel
  } = receiptStateToDisplayableResult(l1TxnHashState);
  return (
    <div>
      <div>
        <form onSubmit={handleSubmit}>
          <div className="form-container">
            <input
              autoFocus
              placeholder="Tx hash"
              value={input}
              onChange={handleChange}
              className="input-style"
            />
            <input type="submit" value="Submit" />
          </div>
        </form>
        <h6>
          Paste your L1 tx hash above and find out whats up with your L1 to L2
          retryable.
        </h6>
      </div>

      <div> {l1TxnResultText} </div>
      <br />
      <div>
        {" "}
        {l1TxnHashState === L1ReceiptState.MESSAGES_FOUND &&
        l1ToL2MessagesDisplays.length === 0
          ? "loading messages..."
          : null}{" "}
      </div>

      {l1ToL2MessagesDisplays.map((l1ToL2MessagesDisplay, i) => {
        return (
          <>
            {
              <>
                <h2>Your transaction status:</h2>
                <p>{l1ToL2MessagesDisplay.text}</p>
                {/* <Redeem
                userTxs={userTxs}
                /> */}
              </>
            }
            <h2>Txn links:</h2>
            <p>
              <br />
              <a
                href={
                  l1ToL2MessagesDisplay.explorerUrl +
                  "/tx/" +
                  l1ToL2MessagesDisplay.retryableCreationId
                }
                rel="noreferrer"
                target="_blank"
              >
                Retryable Ticket
              </a>
              <br />
              <a
                href={
                  l1ToL2MessagesDisplay.explorerUrl +
                  "/tx/" +
                  l1ToL2MessagesDisplay.autoRedeemId
                }
                rel="noreferrer"
                target="_blank"
              >
                Auto Redeem
              </a>
              <br />
              <a
                href={
                  l1ToL2MessagesDisplay.explorerUrl +
                  "/tx/" +
                  l1ToL2MessagesDisplay.l2TxHash
                }
                rel="noreferrer"
                target="_blank"
              >
                L2 tx
              </a>
              <br />
            </p>
          </>
        );
      })}
    </div>
  );
}

export default App;
