export const MAX_SCENARIO_FILE_BYTES = 500_000;

interface ScenarioUploadFile {
  name: string;
  size: number;
  text: () => Promise<string>;
}

export async function readScenarioUploads(files: ScenarioUploadFile[]): Promise<unknown[]> {
  const oversized = files.find((file) => file.size > MAX_SCENARIO_FILE_BYTES);
  if (oversized) {
    throw new Error(`${oversized.name} is too large. Upload a JSON file smaller than 500 KB.`);
  }
  return Promise.all(files.map(async (file) => JSON.parse(await file.text()) as unknown));
}
