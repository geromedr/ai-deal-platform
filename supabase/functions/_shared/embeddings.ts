/**
 * Jina AI Embeddings Client
 *
 * Drop-in replacement for OpenAI text-embedding-3-small.
 * Uses jina-embeddings-v3 (1024 dimensions, task-aware).
 *
 * Env vars required:
 *   JINA_API_KEY  — Jina AI API key
 */

export type EmbeddingTask =
  | "retrieval.passage"   // storing documents in the knowledge base
  | "retrieval.query"     // querying / searching
  | "text-matching"       // semantic similarity
  | "classification"      // classification tasks
  | "separation"          // clustering / separation

export const EMBEDDING_MODEL = "jina-embeddings-v3"
export const EMBEDDING_DIMENSIONS = 1024

/**
 * Generate a single embedding vector for the given text.
 *
 * @param text  - The text to embed
 * @param task  - Jina task type (affects how the model encodes the text)
 * @returns     - Float array of length EMBEDDING_DIMENSIONS (1024)
 */
export async function generateEmbedding(
  text: string,
  task: EmbeddingTask = "retrieval.query"
): Promise<number[]> {
  const apiKey = Deno.env.get("JINA_API_KEY")
  if (!apiKey) throw new Error("JINA_API_KEY not set")

  const response = await fetch("https://api.jina.ai/v1/embeddings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: EMBEDDING_MODEL,
      task,
      input: [text],
      dimensions: EMBEDDING_DIMENSIONS
    })
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Jina embedding request failed (${response.status}): ${errorText}`)
  }

  const data = await response.json()
  const embedding = data?.data?.[0]?.embedding

  if (!Array.isArray(embedding)) {
    throw new Error("Jina response did not include a valid embedding array")
  }

  return embedding
}
