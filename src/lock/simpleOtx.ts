import CKB from '@nervosnetwork/ckb-sdk-core';
import { serializeInput, serializeWitnessArgs } from '@nervosnetwork/ckb-sdk-utils/lib/serialization/transaction';
import { hexToBytes, bytesToHex, sha3, sha3Raw } from 'web3-utils';
import { toHexInLittleEndian, scriptToHash, PERSONAL, hexToBytes as CKBHexToBytes } from '@nervosnetwork/ckb-sdk-utils';
import blake160 from '@nervosnetwork/ckb-sdk-utils/lib/crypto/blake160';
import blake2b from '@nervosnetwork/ckb-sdk-utils/lib/crypto/blake2b';
import { hashPersonalMessage, toBuffer, ecsign, bufferToHex, setLengthLeft } from 'ethereumjs-util';
import groupScripts from './groupScript';

function mergeTypedArraysUnsafe(a: number[], b: number[]): number[] {
  return [...a, ...b];
}

export class SimpleOtx {
  private ckb: CKB;
  constructor(ckb: CKB) {
    this.ckb = ckb;
  }

  calculateSimpleOtxHash(tx: CKBComponents.RawTransactionToSign, beginIndex: number, len: number): string {
    const emptyHashHex = '0x0000000000000000000000000000000000000000000000000000000000000000';
    let hashBytes: number[] = [];
    for (let i = 0; i < len; i++) {
      const index = beginIndex + i;
      hashBytes = hashBytes.concat(hexToBytes(serializeInput(tx.inputs[index])));

      console.log('hashBytes 1', bytesToHex(hashBytes));

      const output = tx.outputs[index];
      hashBytes = hashBytes.concat(hexToBytes(toHexInLittleEndian(output.capacity, 8)));
      console.log('hashBytes 2', bytesToHex(hashBytes));
      hashBytes = hashBytes.concat(hexToBytes(scriptToHash(output.lock)));
      console.log('hashBytes 3', bytesToHex(hashBytes));
      if (output.type) {
        hashBytes = hashBytes.concat(hexToBytes(scriptToHash(output.type)));
      } else {
        hashBytes = hashBytes.concat(hexToBytes(emptyHashHex));
      }
      console.log('hashBytes 4', bytesToHex(hashBytes));

      let dataHash = emptyHashHex;
      if (tx.outputsData[index].length > 2) {
        const s = blake2b(32, null, null, PERSONAL);
        s.update(CKBHexToBytes(tx.outputsData[index]));
        dataHash = `0x${s.digest('hex')}`;
      }
      hashBytes = hashBytes.concat(hexToBytes(dataHash));
      console.log('hashBytes 5', bytesToHex(hashBytes));
    }
    const txHash = sha3(bytesToHex(hashBytes));
    return txHash || emptyHashHex;
  }

  signTx(
    rawTx: CKBComponents.RawTransactionToSign,
    privateKey: string,
    beginIndex: number,
    len: number
  ): CKBComponents.RawTransaction {
    const simpleOtxHash = this.calculateSimpleOtxHash(rawTx, beginIndex, len);

    const selectedWitnesses = rawTx.witnesses.slice(beginIndex, beginIndex + len - 1);
    const emptyWitness = {
      ...(selectedWitnesses[0] as CKBComponents.WitnessArgs),
      lock: `0x${'0'.repeat(130)}`,
    };

    const serializedEmptyWitnessBytes = hexToBytes(serializeWitnessArgs(emptyWitness));
    const serialziedEmptyWitnessSize = serializedEmptyWitnessBytes.length;

    // Calculate keccak256 hash for rawTransaction
    let hashBytes = hexToBytes(simpleOtxHash);
    hashBytes = mergeTypedArraysUnsafe(
      hashBytes,
      hexToBytes(toHexInLittleEndian(`0x${serialziedEmptyWitnessSize.toString(16)}`, 8))
    );
    hashBytes = mergeTypedArraysUnsafe(hashBytes, serializedEmptyWitnessBytes);

    selectedWitnesses.slice(1).forEach(w => {
      const bytes = hexToBytes(typeof w === 'string' ? w : serializeWitnessArgs(w));
      hashBytes = mergeTypedArraysUnsafe(
        hashBytes,
        hexToBytes(toHexInLittleEndian(`0x${bytes.length.toString(16)}`, 8))
      );
      hashBytes = mergeTypedArraysUnsafe(hashBytes, bytes);
    });
    let message = sha3(bytesToHex(hashBytes));
    // Ehereum Personal Sign for keccak256 hash of rawTransaction
    message = hashPersonalMessage(toBuffer(message)).toString('hex');

    const privateKeyBuffer = Buffer.from(privateKey.replace('0x', ''), 'hex');
    const messageHashBuffer = Buffer.from(message.replace('0x', ''), 'hex');
    const signatureObj = ecsign(messageHashBuffer, privateKeyBuffer);
    signatureObj.v -= 27;
    const signatureHexString = bufferToHex(
      Buffer.concat([setLengthLeft(signatureObj.r, 32), setLengthLeft(signatureObj.s, 32), toBuffer(signatureObj.v)])
    );
    emptyWitness.lock = signatureHexString;

    const signedWitnesses = [...rawTx.witnesses];
    signedWitnesses[beginIndex] = serializeWitnessArgs(emptyWitness);

    const tx = {
      ...rawTx,
      witnesses: signedWitnesses.map(witness =>
        typeof witness === 'string' ? witness : serializeWitnessArgs(witness)
      ),
    };

    return tx;
  }
}
