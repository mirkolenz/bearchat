// URI templates (RFC 6570), which MCP resource templates use.
import { parseTemplate } from "url-template";

// url-template does not expose the variables, so they are read from the expressions such as `{?q,page*}`.
const expressionPattern = /\{[+#./;?&]?([^}]+)\}/g;

/** The variable names of a template, in order of appearance. */
export function templateVariables(template: string): string[] {
  const variables = [...template.matchAll(expressionPattern)].flatMap((match) =>
    match[1].split(",").map((variable) => variable.replace(/\*$|:\d+$/, "")),
  );
  return [...new Set(variables)];
}

/** Fills a template, leaving out variables without a value. */
export function expandTemplate(template: string, values: Record<string, string>): string {
  return parseTemplate(template).expand(values);
}
