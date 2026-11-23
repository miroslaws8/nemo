import fs from "node:fs";
import path from "node:path";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from "@aws-sdk/client-s3";
import { SKILL_SOURCE } from "../../../engine/skills";
import type { ISkillPromotion, ISkillVersion } from "../../shared/types";
import { HttpError } from "../http-error";
import {
  REGISTRY_FOLDER,
  REGISTRY_MIRROR_DIR,
  REGISTRY_SYNC_MS,
  REGISTRY_TIMEOUT_MS,
} from "../settings";
import type { ISkillRegistrySettings } from "../types";
import {
  asStored,
  changedSince,
  ConsoleSkills,
  hashOf,
  type ISkillStore,
  type IStoredSkill,
  metaSchema,
  metaText,
  promotion,
  readText,
  writeWhole,
} from "./skill-stores";

// Skills in an S3 bucket every console shares (S3-compatible; QA_CONSOLE_SKILLS_*): the
// folders of a console's own store — <prefix>skills/<name>/meta.json and v<n>/skill.yaml, a
// version never changed once written — mirrored into <data dir>/skills-registry. The console reads
// the mirror (ConsoleSkills); only the bucket writes it: a sync downloads what changed (by ETag)
// and drops what went, at start, every REGISTRY_SYNC_MS and after the console writes. Writing a
// version puts its file first and then meta.json naming it, so a reader never meets a meta.json
// whose version is not there yet. Every console given a key that may write writes it, the team's
// and each Mac's (docs/guide.md → Skill store). A skill here wins over the repo's of the same name.

// What the mirror takes from the bucket: a skill's meta.json and its versions' skill.yaml.
const MIRRORED = /^[a-z0-9][a-z0-9-]*\/(meta\.json|v[1-9][0-9]*\/skill\.yaml)$/;
const META = "meta.json";

interface IBucketObject {
  key: string;
  etag: string;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The bucket, through the S3 API: what is in a folder, and reading and writing one object. */
export class SkillBucket {
  private readonly client: S3Client;

  constructor(private readonly settings: ISkillRegistrySettings) {
    this.client = new S3Client({
      endpoint: settings.endpoint,
      region: settings.region,
      forcePathStyle: settings.pathStyle,
      credentials: {
        accessKeyId: settings.accessKeyId,
        secretAccessKey: settings.secretAccessKey,
      },
    });
  }

  async list(folder: string): Promise<IBucketObject[]> {
    const objects: IBucketObject[] = [];
    let token: string | undefined;
    do {
      const page = await this.client
        .send(
          new ListObjectsV2Command({
            Bucket: this.settings.bucket,
            Prefix: folder,
            ContinuationToken: token,
          }),
          { abortSignal: AbortSignal.timeout(REGISTRY_TIMEOUT_MS) }
        )
        .catch((error: unknown) => this.failed(error));
      for (const item of page.Contents ?? []) {
        if (item.Key !== undefined) {
          objects.push({ key: item.Key, etag: item.ETag ?? "" });
        }
      }
      token =
        page.IsTruncated === true ? page.NextContinuationToken : undefined;
    } while (token !== undefined);
    return objects;
  }

  async read(key: string): Promise<string> {
    const object = await this.client
      .send(new GetObjectCommand({ Bucket: this.settings.bucket, Key: key }), {
        abortSignal: AbortSignal.timeout(REGISTRY_TIMEOUT_MS),
      })
      .catch((error: unknown) => this.failed(error));
    return (await object.Body?.transformToString("utf-8")) ?? "";
  }

  /** Writes one object; `onlyIfNew`: refused (409) when the key is there already. */
  async write(key: string, text: string, onlyIfNew: boolean): Promise<void> {
    await this.client
      .send(
        new PutObjectCommand({
          Bucket: this.settings.bucket,
          Key: key,
          Body: text,
          ContentType: key.endsWith(".json")
            ? "application/json"
            : "application/yaml",
          IfNoneMatch: onlyIfNew ? "*" : undefined,
        }),
        { abortSignal: AbortSignal.timeout(REGISTRY_TIMEOUT_MS) }
      )
      .catch((error: unknown) => this.failed(error));
  }

  async remove(key: string): Promise<void> {
    await this.client
      .send(
        new DeleteObjectCommand({ Bucket: this.settings.bucket, Key: key }),
        { abortSignal: AbortSignal.timeout(REGISTRY_TIMEOUT_MS) }
      )
      .catch((error: unknown) => this.failed(error));
  }

  private failed(error: unknown): never {
    if (
      error instanceof S3ServiceException &&
      error.$metadata.httpStatusCode === 412
    ) {
      throw new HttpError(
        409,
        "Another console wrote this version first: open the skill again"
      );
    }
    throw new HttpError(
      502,
      `The skill store (bucket ${
        this.settings.bucket
      }) did not answer: ${messageOf(error)}`
    );
  }
}

/** Where the skills are in a bucket: its folder for them, under the settings' prefix. */
export function registryFolder(settings: ISkillRegistrySettings): string {
  return `${settings.prefix}${REGISTRY_FOLDER}`;
}

/** A version of a skill to write: its skill.yaml, and who made it when. */
export interface IVersionToWrite {
  yaml: string;
  by: string | null;
  at: string;
}

/** The skills in a bucket, by name, each with its versions and the one promoted to prod. */
export async function storedMetas(
  bucket: SkillBucket,
  folder: string
): Promise<
  Map<string, { versions: ISkillVersion[]; prod: ISkillPromotion | null }>
> {
  const metas = new Map<
    string,
    { versions: ISkillVersion[]; prod: ISkillPromotion | null }
  >();
  for (const object of await bucket.list(folder)) {
    const relative = object.key.slice(folder.length);
    if (!MIRRORED.test(relative) || !relative.endsWith(`/${META}`)) {
      continue;
    }
    const parsed = metaSchema.safeParse(
      JSON.parse(await bucket.read(object.key))
    );
    if (parsed.success) {
      metas.set(relative.slice(0, -`/${META}`.length), parsed.data);
    }
  }
  return metas;
}

/** Writes a skill's versions at once (a migration): each version's file, then meta.json. */
export async function writeSkill(
  bucket: SkillBucket,
  folder: string,
  name: string,
  versions: IVersionToWrite[],
  prodVersion: number | null
): Promise<void> {
  const written: ISkillVersion[] = [];
  for (const [index, version] of versions.entries()) {
    const stored = asStored(version.yaml);
    await bucket.write(
      `${folder}${name}/v${index + 1}/${SKILL_SOURCE}`,
      stored,
      true
    );
    written.push({
      version: index + 1,
      by: version.by,
      at: version.at,
      hash: hashOf(stored),
    });
  }
  const prod = written.find((version) => version.version === prodVersion);
  await bucket.write(
    `${folder}${name}/${META}`,
    metaText(
      written,
      prod === undefined
        ? null
        : { version: prod.version, by: prod.by, at: new Date().toISOString() }
    ),
    false
  );
}

/** A console's skills in the shared bucket, read from its mirror on the data volume. */
export class RegistrySkills implements ISkillStore {
  readonly kind = "registry";
  readonly wins = true;
  private readonly bucket: SkillBucket;
  private readonly mirror: ConsoleSkills;
  private readonly mirrorRoot: string;
  // The ETag of each object the mirror holds, by its path under the folder.
  private readonly indexFile: string;
  private readonly folder: string;
  private syncing: Promise<void> | null = null;

  constructor(
    settings: ISkillRegistrySettings,
    dataDir: string,
    // Why this console only reads the bucket; null: it writes too.
    readonly readOnly: string | null
  ) {
    this.bucket = new SkillBucket(settings);
    this.mirrorRoot = path.join(dataDir, REGISTRY_MIRROR_DIR);
    this.indexFile = `${this.mirrorRoot}.etags.json`;
    this.mirror = new ConsoleSkills(this.mirrorRoot);
    this.folder = registryFolder(settings);
    void this.syncQuietly();
    setInterval(() => void this.syncQuietly(), REGISTRY_SYNC_MS).unref();
  }

  list(): IStoredSkill[] {
    return this.mirror.list();
  }

  current(name: string): IStoredSkill | null {
    return this.mirror.current(name);
  }

  yamlOf(name: string, version: number): string | null {
    return this.mirror.yamlOf(name, version);
  }

  async add(
    name: string,
    yaml: string,
    _skillMd: string,
    by: string | null
  ): Promise<void> {
    this.requireWritable();
    await this.sync();
    if (this.mirror.current(name) !== null) {
      throw new HttpError(
        409,
        `${name} is in the skill store already: open it to replace it`
      );
    }
    await this.publish(name, [], null, yaml, by);
  }

  async replace(
    name: string,
    yaml: string,
    _skillMd: string,
    basedOn: string,
    by: string | null
  ): Promise<void> {
    this.requireWritable();
    await this.sync();
    const now = this.mirror.current(name);
    if (now === null) {
      throw new HttpError(404, `${name} is not in the skill store`);
    }
    if (now.hash !== basedOn) {
      throw changedSince(name);
    }
    await this.publish(name, now.versions, now.prod, yaml, by);
  }

  removable(name: string): boolean {
    return this.readOnly === null && this.mirror.current(name) !== null;
  }

  // meta.json first (the skill is gone for every console at once), then its versions' files.
  async remove(name: string): Promise<void> {
    this.requireWritable();
    await this.sync();
    if (this.mirror.current(name) === null) {
      throw new HttpError(404, `${name} is not in the skill store`);
    }
    const objects = (await this.bucket.list(`${this.folder}${name}/`)).sort(
      (first, second) =>
        Number(second.key.endsWith(META)) - Number(first.key.endsWith(META))
    );
    for (const object of objects) {
      await this.bucket.remove(object.key);
    }
    await this.sync();
  }

  async promote(
    name: string,
    version: number,
    by: string | null
  ): Promise<void> {
    this.requireWritable();
    await this.sync();
    const now = this.mirror.current(name);
    if (now === null) {
      throw new HttpError(404, `${name} is not in the skill store`);
    }
    await this.bucket.write(
      `${this.folder}${name}/${META}`,
      metaText(now.versions, promotion(now, version, by)),
      false
    );
    await this.sync();
  }

  /** The mirror made the bucket's (one sync at a time; a caller during one waits for it). */
  sync(): Promise<void> {
    this.syncing ??= this.pull().finally(() => {
      this.syncing = null;
    });
    return this.syncing;
  }

  // The version's file (refused when another console wrote that version first), then meta.json
  // naming it, then the mirror.
  private async publish(
    name: string,
    earlier: ISkillVersion[],
    prod: ISkillPromotion | null,
    yaml: string,
    by: string | null
  ): Promise<void> {
    const stored = asStored(yaml);
    const version = (earlier.at(-1)?.version ?? 0) + 1;
    await this.bucket.write(
      `${this.folder}${name}/v${version}/${SKILL_SOURCE}`,
      stored,
      true
    );
    const versions: ISkillVersion[] = [
      ...earlier,
      { version, by, at: new Date().toISOString(), hash: hashOf(stored) },
    ];
    await this.bucket.write(
      `${this.folder}${name}/${META}`,
      metaText(versions, prod),
      false
    );
    await this.sync();
  }

  // What changed comes down (the versions' files before the meta.json naming them); what went
  // leaves the mirror. A bucket that does not answer leaves the mirror as it was.
  private async pull(): Promise<void> {
    const objects = (await this.bucket.list(this.folder))
      .map((object) => ({
        ...object,
        relative: object.key.slice(this.folder.length),
      }))
      .filter((object) => MIRRORED.test(object.relative))
      .sort(
        (first, second) =>
          Number(first.relative.endsWith(META)) -
          Number(second.relative.endsWith(META))
      );
    const known = this.readIndex();
    const next: Record<string, string> = {};
    for (const object of objects) {
      const file = path.join(this.mirrorRoot, object.relative);
      if (known[object.relative] !== object.etag || !fs.existsSync(file)) {
        const text = await this.bucket.read(object.key);
        fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
        writeWhole(file, text, 0o600);
      }
      next[object.relative] = object.etag;
    }
    for (const relative of Object.keys(known)) {
      if (!(relative in next) && MIRRORED.test(relative)) {
        fs.rmSync(path.join(this.mirrorRoot, relative), { force: true });
      }
    }
    writeWhole(this.indexFile, `${JSON.stringify(next)}\n`, 0o600);
  }

  private requireWritable(): void {
    if (this.readOnly !== null) {
      throw new HttpError(403, this.readOnly);
    }
  }

  private readIndex(): Record<string, string> {
    try {
      const parsed: unknown = JSON.parse(readText(this.indexFile) ?? "{}");
      return typeof parsed === "object" && parsed !== null
        ? Object.fromEntries(
            Object.entries(parsed).filter(
              (entry): entry is [string, string] => typeof entry[1] === "string"
            )
          )
        : {};
    } catch {
      return {};
    }
  }

  private async syncQuietly(): Promise<void> {
    try {
      await this.sync();
    } catch (error) {
      console.error(`Skill store: ${messageOf(error)}`);
    }
  }
}
