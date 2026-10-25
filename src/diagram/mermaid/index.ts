// Mermaid → Excalidraw elements. Entry point shared by the Mermaid dialog and text-to-diagram.
import type { ExcalidrawElement } from "../../core/types";
import { type BuildOptions, MermaidError, makeCtx, normalizePosition, toStatements } from "./common";
import { flowchartToElements, parseFlowchart } from "./flowchart";
import { parseSequence, sequenceToElements } from "./sequence";
import { classDiagramToElements, parseClassDiagram } from "./classDiagram";
import { erDiagramToElements, parseErDiagram } from "./erDiagram";
import { parseStateDiagram, stateDiagramToElements } from "./stateDiagram";
import { parsePie, pieToElements } from "./pie";

export { MermaidError } from "./common";
export type { ArrowStyle, BuildOptions, Measure } from "./common";

export type DiagramKind = "flowchart" | "sequence" | "class" | "er" | "state" | "pie";

export const DIAGRAM_KEYWORDS: Record<string, DiagramKind> = {
  flowchart: "flowchart",
  "flowchart-elk": "flowchart",
  graph: "flowchart",
  sequenceDiagram: "sequence",
  classDiagram: "class",
  "classDiagram-v2": "class",
  erDiagram: "er",
  stateDiagram: "state",
  "stateDiagram-v2": "state",
  pie: "pie",
};

/** Diagram kind of a Mermaid source (first statement keyword), or null if unknown. */
export function detectDiagramKind(src: string): DiagramKind | null {
  const { stmts } = toStatements(src);
  const first = stmts[0]?.text.split(/\s+/)[0] ?? "";
  return DIAGRAM_KEYWORDS[first] ?? null;
}

export interface ConvertResult {
  kind: DiagramKind;
  elements: ExcalidrawElement[];
}

export function mermaidToElements(src: string, opts: BuildOptions = {}): ConvertResult {
  const ctx = makeCtx(opts);
  const first = toStatements(src).stmts[0];
  if (!first) throw new MermaidError("The diagram is empty", 1);
  const keyword = first.text.split(/[\s;]+/)[0];
  const kind = DIAGRAM_KEYWORDS[keyword];
  if (!kind) {
    throw new MermaidError(
      `Unsupported diagram type "${keyword}". Supported: flowchart/graph, sequenceDiagram, classDiagram, erDiagram, stateDiagram-v2, pie`,
      first.line,
    );
  }
  const { stmts, title } = toStatements(src, kind === "flowchart");
  let elements: ExcalidrawElement[];
  switch (kind) {
    case "flowchart":
      elements = flowchartToElements(parseFlowchart(stmts), ctx);
      break;
    case "sequence":
      elements = sequenceToElements(parseSequence(stmts, title), ctx);
      break;
    case "class":
      elements = classDiagramToElements(parseClassDiagram(stmts), ctx);
      break;
    case "er":
      elements = erDiagramToElements(parseErDiagram(stmts), ctx);
      break;
    case "state":
      elements = stateDiagramToElements(parseStateDiagram(stmts), ctx);
      break;
    case "pie":
      elements = pieToElements(parsePie(stmts, title), ctx);
      break;
  }
  if (!elements.length) throw new MermaidError("The diagram has no content", first.line);
  return { kind, elements: normalizePosition(elements) };
}

export const MERMAID_EXAMPLES: { id: DiagramKind; label: string; code: string }[] = [
  {
    id: "flowchart",
    label: "Flowchart",
    code: `flowchart TD
    A([Start]) --> B{Is it working?}
    B -->|Yes| C[Great!]
    B -->|No| D[Debug it]
    D --> E[(Logs)]
    E -.-> B
    C ==> F((Ship))
    subgraph Review [Code review]
      D
      E
    end
    classDef good fill:#b2f2bb,stroke:#2f9e44
    class C,F good`,
  },
  {
    id: "sequence",
    label: "Sequence",
    code: `sequenceDiagram
    actor User
    participant App
    participant API as Server API
    User->>App: Click "Save"
    activate App
    App->>+API: POST /scene
    Note right of API: Validate & store
    alt success
      API-->>App: 200 OK
    else failure
      API-->>App: 500 Error
    end
    deactivate API
    App-->>User: Show toast
    deactivate App`,
  },
  {
    id: "class",
    label: "Class",
    code: `classDiagram
    class Shape {
      <<abstract>>
      +String id
      +draw() void
    }
    class Rectangle {
      +int width
      +int height
    }
    class Canvas {
      +List~Shape~ shapes
      +render()
    }
    Shape <|-- Rectangle
    Shape <|-- Ellipse
    Canvas "1" *-- "*" Shape : contains`,
  },
  {
    id: "er",
    label: "Entity relationship",
    code: `erDiagram
    CUSTOMER ||--o{ ORDER : places
    ORDER ||--|{ LINE_ITEM : contains
    PRODUCT ||--o{ LINE_ITEM : "ordered in"
    CUSTOMER {
      string name
      string email PK
    }
    ORDER {
      int id PK
      date created
    }`,
  },
  {
    id: "state",
    label: "State",
    code: `stateDiagram-v2
    [*] --> Idle
    Idle --> Drawing : pointer down
    Drawing --> Idle : pointer up
    Idle --> Editing : double click
    state Editing {
      [*] --> Typing
      Typing --> Typing : key
    }
    Editing --> Idle : Escape
    Idle --> [*]`,
  },
  {
    id: "pie",
    label: "Pie",
    code: `pie title Time spent
    "Drawing" : 45
    "Arguing about colors" : 30
    "Meetings" : 15
    "Coffee" : 10`,
  },
];
