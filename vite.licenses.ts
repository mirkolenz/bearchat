import { readdir, readFile } from "node:fs/promises";
import { findPackageJSON } from "node:module";
import { dirname, join } from "node:path";
import type { Plugin } from "vite";

interface Licenses {
  /** The file to write, formatted as Markdown. */
  fileName: string;
  /**
   * Packages `build.license` misses,
   * since only workers or the stylesheet import them.
   */
  packages: string[];
}

/** An entry of the JSON that `build.license` writes. */
interface License {
  name: string;
  version: string;
  identifier?: string;
  text?: string;
}

/** The entry of an installed package. */
async function license(name: string): Promise<License> {
  const manifest = findPackageJSON(name, import.meta.url);

  if (!manifest) throw new Error(`Cannot find the package.json of ${name}.`);

  const dir = dirname(manifest);
  const { version, license: identifier } = JSON.parse(await readFile(manifest, "utf8")) as {
    version: string;
    license?: string;
  };
  const file = (await readdir(dir)).find((entry) => /^(licen[cs]e|copying)/i.test(entry));
  const text = file && (await readFile(join(dir, file), "utf8"));

  return { name, version, identifier, text };
}

function section({ name, version, identifier, text }: License): string {
  const heading = `## ${name} ${version}${identifier ? ` (${identifier})` : ""}`;

  return text ? `${heading}\n\n${text.trim()}` : heading;
}

/** Writes the licenses `build.license` finds together with those of `packages`. */
export function licenses({ fileName, packages }: Licenses): Plugin {
  const json = `${fileName}.json`;

  return {
    name: "licenses",
    config: () => ({ environments: { client: { build: { license: { fileName: json } } } } }),
    generateBundle: {
      // After Vite has emitted its JSON.
      order: "post",
      async handler(_, bundle) {
        const asset = bundle[json];

        if (asset?.type !== "asset" || typeof asset.source !== "string") return;

        delete bundle[json];
        const found = JSON.parse(asset.source) as License[];
        const extra = await Promise.all(packages.map(license));
        const unique = new Map([...found, ...extra].map((e) => [`${e.name}@${e.version}`, e]));
        const sorted = [...unique.values()].toSorted((a, b) => a.name.localeCompare(b.name));
        const source = ["# Licenses", ...sorted.map(section)].join("\n\n");
        this.emitFile({ type: "asset", fileName, source: `${source}\n` });
      },
    },
  };
}
