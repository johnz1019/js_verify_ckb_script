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
import { sha3, hexToNumber, bytesToHex, hexToBytes, padRight } from 'web3-utils';
import { hashPersonalMessage, toBuffer, ecsign, bufferToHex, setLengthLeft } from 'ethereumjs-util';
import { TypedDataUtils, TypedMessage } from 'eth-sig-util';
import * as Config from '../config/chain';
import { createHash } from 'crypto';
import { encode as b64encode, toBuffer } from 'base64url';
import ECPair from '../utils/ecpair';

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

function hash(data) {
  return createHash('SHA256')
    .update(data)
    .digest();
}

Buffer.prototype.bufferString = function() {
  const arr = [...this].join(', ');
  return arr;
};

function sign(data, privateKey) {
  const ecpair = new ECPair(privateKey, { compressed: false });

  const message = hash(Buffer.from(data, 'hex'));
  const sign = ecpair.signRecoverable(message);

  console.log('pubkey ', Buffer.from(ecpair.publicKey.substr(4), 'hex').bufferString());
  console.log('message to sign', Buffer.from(data, 'hex').bufferString());
  console.log('sign is ', Buffer.from(sign.substr(2), 'hex').bufferString());
  console.log('sign is ', sign);
  return sign.substr(2, 128);
}

export class Secp256R1 {
  private ckb: CKB;

  constructor(ckb: CKB) {
    this.ckb = ckb;
  }

  signTransaction(rawTx: CKBComponents.RawTransactionToSign, privateKey: string) {
    const transactionHash = this.ckb.utils.rawTransactionToHash(rawTx);

    console.log('rawTransaction', rawTx);
    console.log('txhash', transactionHash);
    const emptyWitness = {
      ...(rawTx.witnesses[0] as CKBComponents.WitnessArgs),
      lock: `0x${'0'.repeat(600)}`,
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

    let challenge = hash(Buffer.from(hashBytes));
    console.log('challenge', challenge);

    const clientDataObj = {
      type: 'webauthn.get',
      challenge: '5LV5o7HNzikP8oxm24kevNdfp3EujWUSUWX27uFt4rw',
      origin: 'http://localhost:3000',
      crossOrigin: false,
    };
    clientDataObj.challenge = b64encode(challenge, 'hex');
    console.log('challenge', clientDataObj.challenge);

    const clientDataJSON = JSON.stringify(clientDataObj);
    console.log('clientDataJSON', clientDataJSON);

    const clientDataHash = hash(Buffer.from(clientDataJSON)).toString('hex');

    const authrData = '49960de5880e8c687434170f6476605b8fe4aeb9a28632c7995cf3ba831d97630100000002';
    const messageToSign = authrData + clientDataHash;
    console.log('messageToSing', messageToSign);

    const signatureHexString = sign(messageToSign, privateKey);

    emptyWitness.lock = signatureHexString + authrData + Buffer.from(clientDataJSON).toString('hex');
    emptyWitness.lock = '0x' + padRight(emptyWitness.lock, 600, '0');

    console.log('emptyWitness.lock', emptyWitness.lock);

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
