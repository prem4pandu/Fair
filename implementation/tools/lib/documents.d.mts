export type LoadedDocument = {
  file: string;
  line: number;
  exportName: string | null;
  text: string;
  interpolations: number;
  resolved: boolean;
};

export function listDocuments(app: string): LoadedDocument[];
export function loadDocument(
  app: string,
  file: string,
  exportName: string,
): string;
