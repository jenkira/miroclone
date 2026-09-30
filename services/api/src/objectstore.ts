import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

/** The storage the API needs. Any S3-compatible store fits, through the standard S3 API only (section 8.1). */
export interface ObjectStore {
  put(key: string, body: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<Uint8Array | undefined>;
  delete(key: string): Promise<void>;
}

export interface S3Config {
  endpoint?: string;
  region: string;
  bucket: string;
  /** Path-style addressing, which most on-premises stores need. */
  forcePathStyle: boolean;
  accessKeyId: string;
  secretAccessKey: string;
}

/**
 * For a store with a private certificate authority, start Node with NODE_EXTRA_CA_CERTS pointing at the CA file.
 */
export class S3ObjectStore implements ObjectStore {
  private client: S3Client;
  constructor(private cfg: S3Config) {
    this.client = new S3Client({
      endpoint: cfg.endpoint,
      region: cfg.region,
      forcePathStyle: cfg.forcePathStyle,
      // Newer default checksums are not accepted by every S3-compatible store, so send them only when required.
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
      credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
    });
  }
  async put(key: string, body: Uint8Array, contentType: string) {
    await this.client.send(new PutObjectCommand({ Bucket: this.cfg.bucket, Key: key, Body: body, ContentType: contentType }));
  }
  async get(key: string) {
    try {
      const r = await this.client.send(new GetObjectCommand({ Bucket: this.cfg.bucket, Key: key }));
      return await r.Body!.transformToByteArray();
    } catch (e) {
      if ((e as { name?: string }).name === "NoSuchKey") return undefined;
      throw e;
    }
  }
  async delete(key: string) {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.cfg.bucket, Key: key }));
  }
}

export class MemoryObjectStore implements ObjectStore {
  readonly objects = new Map<string, { body: Uint8Array; contentType: string }>();
  async put(key: string, body: Uint8Array, contentType: string) { this.objects.set(key, { body, contentType }); }
  async get(key: string) { return this.objects.get(key)?.body; }
  async delete(key: string) { this.objects.delete(key); }
}
