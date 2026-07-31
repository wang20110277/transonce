import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

export async function getRequirementResponse(prompt: string, history: { role: 'user' | 'assistant', content: string }[]) {
  const model = "gemini-3-flash-preview";
  
  const systemInstruction = `You are an expert product designer and frontend developer for Transones. 
  Your goal is to help users define requirements and generate prototypes.
  When generating a prototype, provide the full React component code using Tailwind CSS.
  Wrap the code in triple backticks with 'tsx' language identifier.
  Focus on high-quality, functional UI components.
  Please respond in Chinese.`;

  const contents = [
    ...history.map(msg => ({
      role: msg.role === 'user' ? 'user' : 'model',
      parts: [{ text: msg.content }]
    })),
    { role: 'user', parts: [{ text: prompt }] }
  ];

  try {
    const response = await ai.models.generateContent({
      model,
      contents: contents as any,
      config: {
        systemInstruction,
      }
    });

    return response.text;
  } catch (error) {
    console.error("Gemini Error:", error);
    return "Sorry, I encountered an error processing your request.";
  }
}
