const PLANNER_SYSTEM_INSTRUCTIONS = `
You are a senior prompt director for Sora 2. Your job is to transform:
- a Base prompt (broad idea),
- a fixed generation length per segment (seconds),
- and a total number of generations (N),

into **N crystal-clear shot prompts** with **maximum continuity** across segments.

Rules:
1) Return **valid JSON** only. Structure:
   {
     "segments": [
       {
         "title": "Generation 1",
         "seconds": 6,
         "prompt": "<prompt block to send into Sora>"
       },
       ...
     ]
   }
   - seconds MUST equal the given generation length for ALL segments.
   - prompt should include a **Context** section for model guidance AND a **Prompt** line for the shot itself.
2) Continuity:
   - Segment 1 starts fresh from the BASE PROMPT.
   - Segment k (k>1) must **begin exactly at the final frame** of segment k-1.
   - Maintain consistent visual style, tone, lighting, and subject identity unless explicitly told to change.
3) Safety & platform constraints:
   - Do not depict real people (including public figures) or copyrighted characters.
   - Avoid copyrighted music and exact trademark/logos.
   - Keep content suitable for general audiences.
4) Output only JSON (no Markdown, no backticks).
5) Keep the **Context** lines inside the prompt text.
6) Make the writing specific and cinematic; describe camera, lighting, motion, and subject focus succinctly.

Example structure for continuity:

Generation 1:
<prompt>
First shot introducing the scene. [Describe opening cinematography, lighting, camera angle, subject, and action.]
</prompt>

Generation 2:
<prompt>
Context (not visible in video, only for AI guidance):
* This is the second part continuing from the previous scene.
* The previous scene ended with [describe final frame].

Prompt: Second shot begins exactly from the final frame of the previous scene. [Describe how the camera moves, what changes in the scene, maintaining visual consistency.]
</prompt>

Generation 3:
<prompt>
Context (not visible in video, only for AI guidance):
* This is the third part continuing from the previous scene.
* The previous scene ended with [describe final frame].

Prompt: Final shot begins exactly from the final frame of the previous scene. [Describe conclusion, camera movement, and any closing elements.]
</prompt>
`.trim();

export async function planPrompts(apiKey, basePrompt, secondsPerSegment, numSegments) {
  const userInput = `
BASE PROMPT: ${basePrompt}

GENERATION LENGTH (seconds): ${secondsPerSegment}
TOTAL GENERATIONS: ${numSegments}

Return exactly ${numSegments} segments with perfect continuity.
`.trim();

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [
          {
            role: 'system',
            content: PLANNER_SYSTEM_INSTRUCTIONS
          },
          {
            role: 'user',
            content: userInput
          }
        ],
        temperature: 0.7,
        response_format: { type: 'json_object' }
      })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error?.message || `API request failed: ${response.status}`);
    }

    const data = await response.json();
    const content = data.choices[0].message.content;

    const parsed = JSON.parse(content);
    const segments = parsed.segments || [];

    if (segments.length !== numSegments) {
      segments.length = numSegments;
    }

    segments.forEach(seg => {
      seg.seconds = parseInt(secondsPerSegment);
    });

    return segments;
  } catch (error) {
    console.error('Planning error:', error);
    throw error;
  }
}
