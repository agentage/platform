// The probe's tool outputs, so tool('probe__echo') resolves { msg: string }.
declare module '@agentage/widget' {
  interface ToolOutputs {
    probe__echo: { msg: string };
  }
}

export {};
