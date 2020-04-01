import CKB from '@nervosnetwork/ckb-sdk-core';
import * as web3Utils from 'web3-utils';
import blake160 from '@nervosnetwork/ckb-sdk-utils/lib/crypto/blake160';
import {
  privateKeyToPublicKey,
  privateKeyToAddress,
  bech32Address,
  AddressPrefix,
  AddressType,
  scriptToHash,
  parseAddress,
  hexToBytes,
  serializeWitnessArgs,
  PERSONAL,
  toHexInLittleEndian,
} from '@nervosnetwork/ckb-sdk-utils';
import ECPair from '@nervosnetwork/ckb-sdk-utils/lib/ecpair';
import blake2b from '@nervosnetwork/ckb-sdk-utils/lib/crypto/blake2b';

export interface Flag {
  s: number;
  r: number;
  m: number;
  n: number;
}
export interface MultiSigScript {
  flag: Flag;
  hashes: string[];
}

export function multiSigScriptToString(script: MultiSigScript): string {
  const toHex = (x: number) =>
    web3Utils.padLeft(web3Utils.numberToHex(x), 2).substr(2);
  const { s, r, m, n } = script.flag;
  const sHex = toHex(s);
  const rHex = toHex(r);
  const mHex = toHex(m);
  const nHex = toHex(n);
  const flag = sHex + rHex + mHex + nHex;
  console.log(`flag is ${flag}`);

  const hashes = script.hashes
    .slice(0, n)
    .map(x => x.replace('0x', ''))
    .join('');

  console.log(`hashes is ${hashes}`);
  const scriptStr = '0x' + flag + hashes;
  return scriptStr;
}

export function multiSigScriptToAddress(
  multiSigScript: MultiSigScript
): string {
  const scriptStr = multiSigScriptToString(multiSigScript);
  console.log(`multiSigScript is ${scriptStr}`);
  const args = '0x' + blake160(scriptStr, 'hex');
  console.log(`args is ${args}`);

  const ckbAddress = bech32Address(args, {
    prefix: AddressPrefix.Testnet,
    type: AddressType.HashIdx,
    codeHashOrCodeHashIndex: '0x01',
  });

  console.log(`ckbAddress is ${ckbAddress}`);
  return ckbAddress;
}

export class Secp256MultiSig {
  private ckb: CKB;

  constructor(ckb: CKB) {
    this.ckb = ckb;
  }

  async loadMultiSigDep(): Promise<DepCellInfo> {
    const genesisBlock = await this.ckb.rpc.getBlockByNumber('0x0');
    /* eslint-disable prettier/prettier, no-undef */
    const secp256k1DepTxHash = genesisBlock?.transactions[1].hash;
    const typeScript = genesisBlock?.transactions[0]?.outputs[4]?.type;
    /* eslint-enable prettier/prettier, no-undef */

    if (!secp256k1DepTxHash) {
      throw new Error(
        'Cannot load the transaction which has the secp256k1 dep cell'
      );
    }

    if (!typeScript) {
      throw new Error('Secp256k1 type script not found');
    }

    const secp256k1TypeHash = this.ckb.utils.scriptToHash(typeScript);

    const secp256k1MultiDep: DepCellInfo = {
      hashType: 'type',
      codeHash: secp256k1TypeHash,
      outPoint: {
        txHash: secp256k1DepTxHash,
        index: '0x1',
      },
    };
    return secp256k1MultiDep;
  }

  signTransaction(
    rawTransaction: CKBComponents.RawTransactionToSign,
    multiSigScript: MultiSigScript,
    keys: string[]
  ) {
    if (keys.length < multiSigScript.flag.m) {
      throw new Error(
        `the count ot keys ${keys.length} is less than multisig script threshold ${multiSigScript.flag.m}`
      );
    }

    const scriptStr = multiSigScriptToString(multiSigScript);

    const transactionHash = this.ckb.utils.rawTransactionToHash(rawTransaction);

    const emptyWitness = {
      ...(rawTransaction.witnesses[0] as CKBComponents.WitnessArgs),
      lock: scriptStr + `${'0'.repeat(130 * keys.length)}`,
    };

    const serializedEmptyWitnessBytes = hexToBytes(
      serializeWitnessArgs(emptyWitness)
    );
    const serialziedEmptyWitnessSize = serializedEmptyWitnessBytes.length;

    const s = blake2b(32, null, null, PERSONAL);
    s.update(hexToBytes(transactionHash));
    s.update(
      hexToBytes(
        toHexInLittleEndian(`0x${serialziedEmptyWitnessSize.toString(16)}`, 8)
      )
    );
    s.update(serializedEmptyWitnessBytes);

    rawTransaction.witnesses.slice(1).forEach(w => {
      const bytes = hexToBytes(
        typeof w === 'string' ? w : serializeWitnessArgs(w)
      );
      s.update(
        hexToBytes(toHexInLittleEndian(`0x${bytes.length.toString(16)}`, 8))
      );
      s.update(bytes);
    });

    const message = `0x${s.digest('hex')}`;

    const sigs = [];
    for (const sk of keys) {
      const keyPair = new ECPair(sk);
      sigs.push(keyPair.signRecoverable(message));
    }
    emptyWitness.lock = scriptStr + sigs.map(x => x.replace('0x', '')).join('');

    const signedWitnesses = [
      serializeWitnessArgs(emptyWitness),
      ...rawTransaction.witnesses.slice(1),
    ];

    const tx = {
      ...rawTransaction,
      witnesses: signedWitnesses.map(witness =>
        typeof witness === 'string' ? witness : serializeWitnessArgs(witness)
      ),
    };

    return tx;
  }
}
