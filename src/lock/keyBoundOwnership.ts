import CKB from '@nervosnetwork/ckb-sdk-core';

export class KeyBoundOwnership {
  private ckb: CKB;
  constructor(ckb: CKB) {
    this.ckb = ckb;
  }

  signTx(tx: CKBComponents.RawTransactionToSign, privateKey?: string) {
    return tx;
  }
}
