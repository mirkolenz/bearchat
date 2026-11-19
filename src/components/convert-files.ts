import { toast } from "@/components/ui/toast";
import { convertFile } from "@/lib/convert";
import { errorMessage } from "@/lib/utils";

/** Converts the files the user added, reporting each one that fails instead of dropping all. */
export async function convertFiles(selected: Iterable<File>): Promise<File[]> {
  const files = Array.from(selected);
  const results = await Promise.allSettled(files.map(convertFile));
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
