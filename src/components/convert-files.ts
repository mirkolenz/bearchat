import { toast } from "@/components/ui/toast";
import { convertFile } from "@/lib/convert";
import { errorMessage, settleConcurrently } from "@/lib/utils";

// Converting decodes full-size images, so that many photos at once would exhaust the memory.
const concurrentConversions = 4;

/** Converts the files the user added, reporting each one that fails instead of dropping all. */
export async function convertFiles(selected: Iterable<File>): Promise<File[]> {
  const files = Array.from(selected);
  const results = await settleConcurrently(files, concurrentConversions, convertFile);
  return results.flatMap((result, index) => {
    if (result.status === "fulfilled") {
      return [result.value];
    }

    toast.add({
      type: "error",
      title: `${files[index].name} was not added`,
      description: errorMessage(result.reason),
    });
    return [];
  });
}
