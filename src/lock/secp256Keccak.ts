//@ts-nocheck
import CKB from '@nervosnetwork/ckb-sdk-core';
import {
  hexToBytes as CKBHexToBytes,
  serializeWitnessArgs,
  toHexInLittleEndian,
  fullPayloadToAddress,
  AddressPrefix,
  AddressType,
  bech32Address,
} from '@nervosnetwork/ckb-sdk-utils';
import { sha3, hexToNumber, bytesToHex, hexToBytes } from 'web3-utils';
import { hashPersonalMessage, toBuffer, ecsign, bufferToHex, setLengthLeft } from 'ethereumjs-util';
import { TypedDataUtils, TypedMessage } from 'eth-sig-util';
import * as Config from '../config/chain';

function formatCKBAddress(address: string): string {
  if (address === null || address.length <= 17) {
    return address;
  }

  const len = address.length;
  const formatedAddress = address.substring(0, 7) + '...' + address.substr(len - 7, 7);
  console.log(address, formatedAddress);
  return formatedAddress;
}

function mergeTypedArraysUnsafe(a: number[], b: number[]): number[] {
  return [...a, ...b];
}

export class Secp256Keccak {
  private ckb: CKB;
  private typedData = {
    domain: {
      chainId: 1,
      name: 'ckb.pw',
      verifyingContract: '0xCcCCccccCCCCcCCCCCCcCcCccCcCCCcCcccccccC',
      version: '1',
    },
    message: {
      hash: '0x545529d4464064d8394c557afb06f489e7044a63984c6113385431d93dcffa1b',
      fee: '0.00100000CKB',
      'input-sum': '100.00000000CKB',
      to: [
        {
          address: 'ckb1qyqv4yga3pgw2h92hcnur7lepdfzmvg8wj7qwstnwm',
          amount: '100.00000000CKB',
        },
        {
          address: 'ckb1qftyhqxwuxdzp5zk4rctscnrr6stjrmfjdx54v05q8t3ad3493m6mhcekrn0vk575h44ql9ry53z3gzhtc2exudxcyg',
          amount: '799.99800000CKB',
        },
      ],
    },
    primaryType: 'CKBTransaction',
    types: {
      EIP712Domain: [
        { name: 'name', type: 'string' },
        { name: 'version', type: 'string' },
        { name: 'chainId', type: 'uint256' },
        { name: 'verifyingContract', type: 'address' },
      ],
      CKBTransaction: [
        { name: 'hash', type: 'bytes32' },
        { name: 'fee', type: 'string' },
        { name: 'input-sum', type: 'string' },
        { name: 'to', type: 'Output[]' },
      ],
      Output: [
        { name: 'address', type: 'string' },
        { name: 'amount', type: 'string' },
      ],
    },
  };

  constructor(ckb: CKB) {
    this.ckb = ckb;
  }

  buildTypedDataHash(unspentEthCells: CachedCell[], rawTx: CKBComponents.RawTransactionToSign, messageHash: string) {
    const typedData = this.typedData;
    typedData.message.hash = messageHash;
    typedData.message.to = [];

    let inputCapacities = 0;
    rawTx.inputs.forEach((input, i) => {
      const cell = unspentEthCells.filter(
        t => t.outPoint?.txHash === input.previousOutput?.txHash && t.outPoint?.index === input.previousOutput?.index
      )[0];

      const { capacity } = cell;
      inputCapacities += hexToNumber(capacity);
    });

    let outputCapacities = 0;
    rawTx.outputs.forEach((output, i) => {
      const { hashType, codeHash, args } = output.lock;

      outputCapacities += hexToNumber(output.capacity);

      const amount = (hexToNumber(output.capacity) / 100000000.0).toFixed(8) + 'CKB';

      let address = 'unknown';
      if (output.lock.codeHash !== '0x00000000000000000000000000000000') {
        if (codeHash === Config.blockAssemblerCode) {
          address = formatCKBAddress(
            bech32Address(args, {
              prefix: AddressPrefix.Testnet,
              type: AddressType.HashIdx,
              codeHashOrCodeHashIndex: '0x00',
            })
          );
        } else {
          let type = AddressType.DataCodeHash;
          if (hashType === 'data') {
            type = AddressType.DataCodeHash;
          } else {
            type = AddressType.TypeCodeHash;
          }
          address = formatCKBAddress(
            fullPayloadToAddress({
              arg: args,
              prefix: AddressPrefix.Testnet,
              type,
              codeHash,
            })
          );
        }
      }
      typedData.message.to.push({ address, amount });
    });

    typedData.message['input-sum'] = (inputCapacities / 100000000.0).toFixed(8) + 'CKB';
    typedData.message.fee = ((inputCapacities - outputCapacities) / 100000000.0).toFixed(8) + 'CKB';

    /* eslint-disable */
    const result = '0x' + TypedDataUtils.sign(typedData, true).toString('hex');
    /* eslint-disable */

    return result;
  }

  signETHTransaction(
    cells: CachedCell[],
    rawTx: CKBComponents.RawTransactionToSign,
    privateKey: string,
    useTypedData?: boolean
  ) {
    const transactionHash = this.ckb.utils.rawTransactionToHash(rawTx);

    console.log('rawTransaction', rawTx);
    console.log('txhash', transactionHash);
    const emptyWitness = {
      ...(rawTx.witnesses[0] as CKBComponents.WitnessArgs),
      lock: `0x${'0'.repeat(130)}`,
    };

    const serializedEmptyWitnessBytes = hexToBytes(serializeWitnessArgs(emptyWitness));
    const serialziedEmptyWitnessSize = serializedEmptyWitnessBytes.length;
    console.log('serialziedEmptyWitnessSize', serialziedEmptyWitnessSize);

    // Calculate keccak256 hash for rawTransaction
    let hashBytes = hexToBytes(transactionHash);
    hashBytes = mergeTypedArraysUnsafe(
      hashBytes,
      hexToBytes(toHexInLittleEndian(`0x${serialziedEmptyWitnessSize.toString(16)}`, 8))
    );
    hashBytes = mergeTypedArraysUnsafe(hashBytes, serializedEmptyWitnessBytes);

    console.log('hashBytes', bytesToHex(hashBytes));

    rawTx.witnesses.slice(1).forEach(w => {
      const bytes = hexToBytes(typeof w === 'string' ? w : serializeWitnessArgs(w));
      hashBytes = mergeTypedArraysUnsafe(
        hashBytes,
        hexToBytes(toHexInLittleEndian(`0x${bytes.length.toString(16)}`, 8))
      );
      hashBytes = mergeTypedArraysUnsafe(hashBytes, bytes);
    });

    console.log('hashBytes', bytesToHex(hashBytes));

    let message = sha3(bytesToHex(hashBytes));

    console.log('baseMessage', message);
    // Ehereum Personal Sign for keccak256 hash of rawTransaction
    message = hashPersonalMessage(toBuffer(message)).toString('hex');

    console.log('hashPersonalMessage', message);

    if (useTypedData) {
      message = this.buildTypedDataHash(cells, rawTx, '0x' + message);
    }

    const privateKeyBuffer = Buffer.from(privateKey.replace('0x', ''), 'hex');
    const messageHashBuffer = Buffer.from(message.replace('0x', ''), 'hex');
    const signatureObj = ecsign(messageHashBuffer, privateKeyBuffer);
    signatureObj.v -= 27;
    const signatureHexString = bufferToHex(
      Buffer.concat([setLengthLeft(signatureObj.r, 32), setLengthLeft(signatureObj.s, 32), toBuffer(signatureObj.v)])
    );
    emptyWitness.lock = signatureHexString;

    const signedWitnesses = [serializeWitnessArgs(emptyWitness), ...rawTx.witnesses.slice(1)];
    const tx = {
      ...rawTx,
      witnesses: signedWitnesses.map(witness =>
        typeof witness === 'string' ? witness : serializeWitnessArgs(witness)
      ),
    };

    return tx;
  }
}
