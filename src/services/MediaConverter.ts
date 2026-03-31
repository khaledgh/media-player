import * as FileSystem from "expo-file-system/legacy";

const BACKEND_URL = "https://yt.linksbridge.top"; // Updated to use the remote backend.

export const extractAudioFromVideo = async (
  videoUri: string,
  outputName: string,
): Promise<string | null> => {
  const outputUri = `${FileSystem.documentDirectory}${outputName}.mp3`;

  try {
    const response = await fetch(`${BACKEND_URL}/extract-audio`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ videoUri }),
    });

    if (!response.ok) {
      console.error("Backend extraction failed:", response.status);
      return null;
    }

    const audioBlob = await response.blob();
    const reader = new FileReader();

    return new Promise((resolve, reject) => {
      reader.onloadend = async () => {
        try {
          const base64data = (reader.result as string).split(",")[1];
          await FileSystem.writeAsStringAsync(outputUri, base64data, {
            encoding: FileSystem.EncodingType.Base64,
          });
          resolve(outputUri);
        } catch (error) {
          console.error("Error saving audio file:", error);
          reject(null);
        }
      };
      reader.onerror = () => reject(null);
      reader.readAsDataURL(audioBlob);
    });
  } catch (error) {
    console.error("Error extracting audio:", error);
    return null;
  }
};
