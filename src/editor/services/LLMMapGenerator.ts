/**
 * LLMMapGenerator - Multi-provider LLM service for AI map generation
 *
 * Supports Claude, OpenAI, and Gemini APIs with tool/function calling.
 * Generates MapBlueprint objects that are converted to full map data.
 */

import { debugInitialization } from '@/utils/debugLogger';
import type {
  MapBlueprint,
  BiomeType,
  DecorationStyle,
} from '@/data/maps/core/ElevationMap';
import { generateMap } from '@/data/maps/core/ElevationMapGenerator';
import type { MapData } from '@/data/maps/MapTypes';

// ============================================================================
// TYPES
// ============================================================================

export type LLMProvider = 'claude' | 'openai' | 'gemini';

export interface LLMConfig {
  provider: LLMProvider;
  apiKey: string;
  model?: string;
}

export interface MapGenerationSettings {
  playerCount: 2 | 4 | 6 | 8;
  mapSize: 'small' | 'medium' | 'large' | 'huge';
  biome: BiomeType;
  theme: string; // User's description/prompt
  includeWater: boolean;
  includeForests: boolean;
  islandMap: boolean;
  borderStyle: 'rocks' | 'crystals' | 'trees' | 'mixed' | 'none';
}

export interface GenerationResult {
  success: boolean;
  mapData?: MapData;
  blueprint?: MapBlueprint;
  error?: string;
  rawResponse?: unknown;
}

// Map sizes in cells
const MAP_SIZES: Record<MapGenerationSettings['mapSize'], { width: number; height: number }> = {
  small: { width: 128, height: 128 },
  medium: { width: 192, height: 192 },
  large: { width: 320, height: 320 },
  huge: { width: 512, height: 512 },
};

// Default models per provider
const DEFAULT_MODELS: Record<LLMProvider, string> = {
  claude: 'claude-sonnet-4-20250514',
  openai: 'gpt-4o',
  gemini: 'gemini-2.0-flash',
};

// ============================================================================
// TOOL SCHEMA
// ============================================================================

/**
 * JSON Schema for the MapBlueprint tool.
 * This is the contract between the LLM and our map generator.
 */
const MAP_BLUEPRINT_SCHEMA = {
  type: 'object',
  required: ['meta', 'canvas', 'paint', 'bases'],
  properties: {
    meta: {
      type: 'object',
      required: ['id', 'name', 'players'],
      properties: {
        id: { type: 'string', description: 'Unique snake_case identifier' },
        name: { type: 'string', description: 'Display name for the map' },
        author: { type: 'string', description: 'Map author (use "AI Generator")' },
        description: { type: 'string', description: 'Brief description of the map theme and gameplay' },
        players: { type: 'number', enum: [2, 4, 6, 8], description: 'Number of players' },
      },
    },
    canvas: {
      type: 'object',
      required: ['width', 'height', 'biome'],
      properties: {
        width: { type: 'number', description: 'Map width in cells (128-512)' },
        height: { type: 'number', description: 'Map height in cells (128-512)' },
        biome: {
          type: 'string',
          enum: ['grassland', 'desert', 'frozen', 'volcanic', 'void', 'jungle'],
          description: 'Visual biome theme',
        },
      },
    },
    paint: {
      type: 'array',
      description: 'Paint commands executed in order to build terrain. Order matters - later commands override earlier ones.',
      items: {
        oneOf: [
          {
            type: 'object',
            required: ['cmd', 'elevation'],
            properties: {
              cmd: { const: 'fill' },
              elevation: { type: 'number', description: 'Base elevation (use 60 for LOW ground)' },
            },
          },
          {
            type: 'object',
            required: ['cmd', 'x', 'y', 'radius', 'elevation'],
            properties: {
              cmd: { const: 'plateau' },
              x: { type: 'number' },
              y: { type: 'number' },
              radius: { type: 'number', description: 'Radius in cells (16-30 typical)' },
              elevation: { type: 'number', description: 'Elevation: 60=LOW, 140=MID, 220=HIGH' },
            },
          },
          {
            type: 'object',
            required: ['cmd', 'x', 'y', 'width', 'height', 'elevation'],
            properties: {
              cmd: { const: 'rect' },
              x: { type: 'number' },
              y: { type: 'number' },
              width: { type: 'number' },
              height: { type: 'number' },
              elevation: { type: 'number' },
            },
          },
          {
            type: 'object',
            required: ['cmd', 'from', 'to', 'width'],
            properties: {
              cmd: { const: 'ramp' },
              from: {
                type: 'array',
                items: { type: 'number' },
                minItems: 2,
                maxItems: 2,
                description: '[x, y] start point (on higher elevation)',
              },
              to: {
                type: 'array',
                items: { type: 'number' },
                minItems: 2,
                maxItems: 2,
                description: '[x, y] end point (on lower elevation)',
              },
              width: { type: 'number', description: 'Ramp width (8-14 typical)' },
            },
          },
          {
            type: 'object',
            required: ['cmd', 'x', 'y'],
            properties: {
              cmd: { const: 'water' },
              x: { type: 'number' },
              y: { type: 'number' },
              radius: { type: 'number', description: 'For circular water' },
              width: { type: 'number', description: 'For rectangular water' },
              height: { type: 'number', description: 'For rectangular water' },
              depth: { type: 'string', enum: ['shallow', 'deep'], description: 'shallow=walkable slow, deep=impassable' },
            },
          },
          {
            type: 'object',
            required: ['cmd', 'x', 'y', 'density'],
            properties: {
              cmd: { const: 'forest' },
              x: { type: 'number' },
              y: { type: 'number' },
              radius: { type: 'number' },
              width: { type: 'number' },
              height: { type: 'number' },
              density: { type: 'string', enum: ['sparse', 'light', 'medium', 'dense'] },
            },
          },
          {
            type: 'object',
            required: ['cmd', 'x', 'y'],
            properties: {
              cmd: { const: 'void' },
              x: { type: 'number' },
              y: { type: 'number' },
              radius: { type: 'number' },
              width: { type: 'number' },
              height: { type: 'number' },
            },
          },
          {
            type: 'object',
            required: ['cmd', 'from', 'to', 'width'],
            properties: {
              cmd: { const: 'road' },
              from: { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2 },
              to: { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2 },
              width: { type: 'number' },
            },
          },
          {
            type: 'object',
            required: ['cmd', 'x', 'y'],
            properties: {
              cmd: { const: 'unwalkable' },
              x: { type: 'number' },
              y: { type: 'number' },
              radius: { type: 'number' },
              width: { type: 'number' },
              height: { type: 'number' },
            },
          },
          {
            type: 'object',
            required: ['cmd', 'thickness'],
            properties: {
              cmd: { const: 'border' },
              thickness: { type: 'number', description: 'Border thickness (10-15 typical)' },
            },
          },
          {
            type: 'object',
            required: ['cmd', 'x', 'y', 'radius'],
            properties: {
              cmd: { const: 'mud' },
              x: { type: 'number' },
              y: { type: 'number' },
              radius: { type: 'number' },
            },
          },
        ],
      },
    },
    bases: {
      type: 'array',
      description: 'Base locations including spawns and expansions. Each player needs main + natural + third minimum.',
      items: {
        type: 'object',
        required: ['x', 'y', 'type'],
        properties: {
          x: { type: 'number' },
          y: { type: 'number' },
          type: {
            type: 'string',
            enum: ['main', 'natural', 'third', 'fourth', 'fifth', 'gold', 'pocket'],
            description: 'main=spawn, natural=first expansion, third/fourth=later expansions, gold=rich minerals',
          },
          playerSlot: { type: 'number', description: 'Player number (1-8) for main bases' },
          mineralDirection: {
            type: 'string',
            enum: ['up', 'down', 'left', 'right', 'up_left', 'up_right', 'down_left', 'down_right'],
            description: 'Direction minerals face from command center',
          },
          isGold: { type: 'boolean', description: 'Rich mineral base' },
        },
      },
    },
    watchTowers: {
      type: 'array',
      description: 'Vision-granting neutral structures at strategic locations',
      items: {
        type: 'object',
        required: ['x', 'y', 'vision'],
        properties: {
          x: { type: 'number' },
          y: { type: 'number' },
          vision: { type: 'number', description: 'Vision radius (20-40 typical)' },
        },
      },
    },
    destructibles: {
      type: 'array',
      description: 'Breakable rocks that block paths until destroyed',
      items: {
        type: 'object',
        required: ['x', 'y', 'health'],
        properties: {
          x: { type: 'number' },
          y: { type: 'number' },
          health: { type: 'number', description: 'Health points (500-2000 typical)' },
          size: { type: 'string', enum: ['small', 'medium', 'large'] },
        },
      },
    },
    decorationRules: {
      type: 'object',
      description: 'Procedural decoration generation rules',
      properties: {
        border: {
          type: 'object',
          properties: {
            style: { type: 'string', enum: ['rocks', 'crystals', 'trees', 'mixed', 'alien', 'dead_trees'] },
            density: { type: 'number', description: '0-1, how densely packed' },
            scale: {
              type: 'array',
              items: { type: 'number' },
              minItems: 2,
              maxItems: 2,
              description: '[min, max] scale multiplier',
            },
            innerOffset: { type: 'number', description: 'Distance from edge for inner ring' },
            outerOffset: { type: 'number', description: 'Distance from edge for outer ring' },
          },
        },
        cliffEdges: {
          type: 'object',
          properties: {
            enabled: { type: 'boolean' },
            rocks: { type: 'boolean' },
            crystals: { type: 'boolean' },
            trees: { type: 'boolean' },
            density: { type: 'number' },
          },
        },
        scatter: {
          type: 'object',
          description: 'Random decoration density across map',
          properties: {
            rocks: { type: 'number' },
            crystals: { type: 'number' },
            trees: { type: 'number' },
            deadTrees: { type: 'number' },
            alienTrees: { type: 'number' },
            grass: { type: 'number' },
            debris: { type: 'number' },
          },
        },
        baseRings: {
          type: 'object',
          description: 'Decorations around base locations',
          properties: {
            rocks: { type: 'number' },
            trees: { type: 'number' },
            crystals: { type: 'number' },
          },
        },
        seed: { type: 'number', description: 'Random seed for reproducibility' },
      },
    },
    explicitDecorations: {
      type: 'array',
      description: 'Manually placed decorations for specific visual effects',
      items: {
        type: 'object',
        required: ['type', 'x', 'y'],
        properties: {
          type: {
            type: 'string',
            enum: [
              'rocks_small', 'rocks_large', 'rock_single', 'crystal_formation',
              'tree_dead', 'tree_alien', 'tree_pine_tall', 'tree_palm', 'tree_mushroom',
              'bush', 'grass_clump', 'debris', 'ruined_wall', 'escape_pod',
            ],
          },
          x: { type: 'number' },
          y: { type: 'number' },
          scale: { type: 'number', description: 'Size multiplier (0.5-3.0)' },
          rotation: { type: 'number', description: 'Rotation in radians' },
        },
      },
    },
  },
} as const;

/**
 * Gemini-compatible schema (no const, no oneOf, string enums only)
 */
const GEMINI_SCHEMA = {
  type: 'object',
  required: ['meta', 'canvas', 'paint', 'bases'],
  properties: {
    meta: {
      type: 'object',
      required: ['id', 'name', 'players'],
      properties: {
        id: { type: 'string', description: 'Unique snake_case identifier' },
        name: { type: 'string', description: 'Display name for the map' },
        author: { type: 'string', description: 'Map author (use "AI Generator")' },
        description: { type: 'string', description: 'Brief description of the map theme and gameplay' },
        players: { type: 'integer', description: 'Number of players: 2, 4, 6, or 8' },
      },
    },
    canvas: {
      type: 'object',
      required: ['width', 'height', 'biome'],
      properties: {
        width: { type: 'integer', description: 'Map width in cells (128-512)' },
        height: { type: 'integer', description: 'Map height in cells (128-512)' },
        biome: {
          type: 'string',
          enum: ['grassland', 'desert', 'frozen', 'volcanic', 'void', 'jungle'],
          description: 'Visual biome theme',
        },
      },
    },
    paint: {
      type: 'array',
      description: 'Paint commands executed in order. Each object has cmd (fill/plateau/rect/ramp/water/forest/void/road/unwalkable/border/mud) plus relevant properties.',
      items: {
        type: 'object',
        required: ['cmd'],
        properties: {
          cmd: {
            type: 'string',
            enum: ['fill', 'plateau', 'rect', 'ramp', 'water', 'forest', 'void', 'road', 'unwalkable', 'border', 'mud'],
            description: 'Command type',
          },
          elevation: { type: 'integer', description: 'Elevation: 60=LOW, 140=MID, 220=HIGH' },
          x: { type: 'number', description: 'X coordinate' },
          y: { type: 'number', description: 'Y coordinate' },
          radius: { type: 'number', description: 'Radius for circular shapes' },
          width: { type: 'number', description: 'Width for rectangles or ramp width' },
          height: { type: 'number', description: 'Height for rectangles' },
          thickness: { type: 'number', description: 'Border thickness (10-15 typical)' },
          from: {
            type: 'array',
            items: { type: 'number' },
            description: '[x, y] start point for ramps/roads',
          },
          to: {
            type: 'array',
            items: { type: 'number' },
            description: '[x, y] end point for ramps/roads',
          },
          depth: { type: 'string', enum: ['shallow', 'deep'], description: 'Water depth' },
          density: { type: 'string', enum: ['sparse', 'light', 'medium', 'dense'], description: 'Forest density' },
        },
      },
    },
    bases: {
      type: 'array',
      description: 'Base locations. Each player needs main + natural + third minimum.',
      items: {
        type: 'object',
        required: ['x', 'y', 'type'],
        properties: {
          x: { type: 'number' },
          y: { type: 'number' },
          type: {
            type: 'string',
            enum: ['main', 'natural', 'third', 'fourth', 'fifth', 'gold', 'pocket'],
            description: 'Base type',
          },
          playerSlot: { type: 'integer', description: 'Player number (1-8) for main bases' },
          mineralDirection: {
            type: 'string',
            enum: ['up', 'down', 'left', 'right', 'up_left', 'up_right', 'down_left', 'down_right'],
            description: 'Direction minerals face',
          },
          isGold: { type: 'boolean', description: 'Rich mineral base' },
        },
      },
    },
    watchTowers: {
      type: 'array',
      description: 'Vision-granting neutral structures',
      items: {
        type: 'object',
        required: ['x', 'y', 'vision'],
        properties: {
          x: { type: 'number' },
          y: { type: 'number' },
          vision: { type: 'integer', description: 'Vision radius (20-40)' },
        },
      },
    },
    destructibles: {
      type: 'array',
      description: 'Breakable rocks',
      items: {
        type: 'object',
        required: ['x', 'y', 'health'],
        properties: {
          x: { type: 'number' },
          y: { type: 'number' },
          health: { type: 'integer', description: 'Health (500-2000)' },
          size: { type: 'string', enum: ['small', 'medium', 'large'] },
        },
      },
    },
    decorationRules: {
      type: 'object',
      description: 'Procedural decoration rules',
      properties: {
        border: {
          type: 'object',
          properties: {
            style: { type: 'string', enum: ['rocks', 'crystals', 'trees', 'mixed', 'alien', 'dead_trees'] },
            density: { type: 'number', description: '0-1' },
            scale: {
              type: 'array',
              items: { type: 'number' },
              description: '[min, max] scale',
            },
            innerOffset: { type: 'number' },
            outerOffset: { type: 'number' },
          },
        },
        scatter: {
          type: 'object',
          properties: {
            rocks: { type: 'number' },
            debris: { type: 'number' },
          },
        },
        baseRings: {
          type: 'object',
          properties: {
            rocks: { type: 'integer' },
            trees: { type: 'integer' },
          },
        },
        seed: { type: 'integer' },
      },
    },
  },
};

// ============================================================================
// SYSTEM PROMPT
// ============================================================================

const SYSTEM_PROMPT = `You are an expert RTS map designer creating professional competitive maps for VOIDSTRIKE, a classic RTS-style real-time strategy game.

## Map Design Principles

### Elevation System
- Elevation values: LOW=60 (ground), MID=140 (natural level), HIGH=220 (main base level)
- Cliffs automatically form where elevation differs by 40+ units
- Main bases should be on HIGH ground for defender advantage
- Naturals typically on MID ground
- Center and contested areas on LOW ground

### Base Placement Guidelines
- **Main bases**: Place on HIGH elevation, corners or edges, facing inward
- **Natural expansions**: Close to main (30-45 units away), on MID elevation, connected by ramp
- **Third bases**: Further from main, on LOW or MID ground, contestable territory
- **Fourth/Gold bases**: Center or opposite side, high-risk high-reward locations
- Each player's base setup should mirror opponents (symmetric or rotational symmetry)

### Competitive Map Flow
1. Early game: Players defend main + natural with ramp chokepoints
2. Mid game: Contest third bases and map control
3. Late game: Fight over center, gold bases, and positioning

### Ramp Placement
- Every main needs a ramp to natural
- Natural often needs ramp to third/center
- Ramp width affects defensibility: 8-10 = tight choke, 12-14 = wider
- Place ramps FROM high ground TO low ground

### Water Features
- shallow water: walkable at 0.6x speed, unbuildable
- deep water: impassable (for island maps/lakes)
- Use for naval maps, visual interest, or strategic slow zones

### Strategic Features
- Watch towers: Place at contested locations for vision control
- Destructible rocks: Block shortcuts, force early aggression to open paths
- Forests: Block vision, create ambush opportunities
- Void areas: Impassable chasms for visual drama

### Decoration Guidelines
- Border decorations: Use high density (0.6-0.8) with scale [1.5, 3.0] for imposing walls
- Cliff edges: Enable rocks for natural cliff decoration
- Scatter: Keep low (0.1-0.3) to avoid cluttering playable areas
- Match decoration style to biome (rocks for volcanic, crystals for void, trees for jungle)

## Your Task
Generate a complete MapBlueprint using the generate_map_blueprint tool. Create a balanced, visually interesting, competitively viable map based on the user's requirements.

IMPORTANT:
- Always start paint commands with fill(60) to set base elevation
- Always include border command (thickness 12-15) for map edges
- Ensure every main base has a ramp to its natural
- Create symmetric or rotationally symmetric layouts for fairness
- Include decorationRules with appropriate border style and density
- Place watch towers at strategic neutral locations
- Consider destructible rocks to create alternate paths`;

// ============================================================================
// PROVIDER IMPLEMENTATIONS
// ============================================================================

interface ToolCallResult {
  blueprint: MapBlueprint;
}

/**
 * Call Claude API with tool use
 */
async function callClaude(config: LLMConfig, settings: MapGenerationSettings): Promise<ToolCallResult> {
  const model = config.model || DEFAULT_MODELS.claude;
  const size = MAP_SIZES[settings.mapSize];

  const userPrompt = buildUserPrompt(settings, size);

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': config.apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model,
      max_tokens: 8192,
      system: SYSTEM_PROMPT,
      tools: [
        {
          name: 'generate_map_blueprint',
          description: 'Generate a complete RTS map blueprint with terrain, bases, and decorations',
          input_schema: MAP_BLUEPRINT_SCHEMA,
        },
      ],
      tool_choice: { type: 'tool', name: 'generate_map_blueprint' },
      messages: [{ role: 'user', content: userPrompt }],
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Claude API error: ${response.status} - ${error}`);
  }

  const data = await response.json();

  // Extract tool use from response
  const toolUse = data.content?.find((block: { type: string }) => block.type === 'tool_use');
  if (!toolUse || toolUse.name !== 'generate_map_blueprint') {
    throw new Error('Claude did not return expected tool call');
  }

  return { blueprint: toolUse.input as MapBlueprint };
}

/**
 * Call OpenAI API with function calling
 */
async function callOpenAI(config: LLMConfig, settings: MapGenerationSettings): Promise<ToolCallResult> {
  const model = config.model || DEFAULT_MODELS.openai;
  const size = MAP_SIZES[settings.mapSize];

  const userPrompt = buildUserPrompt(settings, size);

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model,
      max_tokens: 8192,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      tools: [
        {
          type: 'function',
          function: {
            name: 'generate_map_blueprint',
            description: 'Generate a complete RTS map blueprint with terrain, bases, and decorations',
            parameters: MAP_BLUEPRINT_SCHEMA,
          },
        },
      ],
      tool_choice: { type: 'function', function: { name: 'generate_map_blueprint' } },
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`OpenAI API error: ${response.status} - ${error}`);
  }

  const data = await response.json();

  // Extract function call from response
  const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
  if (!toolCall || toolCall.function?.name !== 'generate_map_blueprint') {
    throw new Error('OpenAI did not return expected function call');
  }

  const blueprint = JSON.parse(toolCall.function.arguments);
  return { blueprint };
}

/**
 * Call Gemini API with function calling
 */
async function callGemini(config: LLMConfig, settings: MapGenerationSettings): Promise<ToolCallResult> {
  const model = config.model || DEFAULT_MODELS.gemini;
  const size = MAP_SIZES[settings.mapSize];

  const userPrompt = buildUserPrompt(settings, size);

  // Gemini uses a different API structure
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${config.apiKey}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: SYSTEM_PROMPT }],
        },
        contents: [
          {
            role: 'user',
            parts: [{ text: userPrompt }],
          },
        ],
        tools: [
          {
            functionDeclarations: [
              {
                name: 'generate_map_blueprint',
                description: 'Generate a complete RTS map blueprint with terrain, bases, and decorations',
                parameters: GEMINI_SCHEMA,
              },
            ],
          },
        ],
        toolConfig: {
          functionCallingConfig: {
            mode: 'ANY',
            allowedFunctionNames: ['generate_map_blueprint'],
          },
        },
        generationConfig: {
          maxOutputTokens: 8192,
        },
      }),
    }
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Gemini API error: ${response.status} - ${error}`);
  }

  const data = await response.json();

  // Extract function call from Gemini response
  const functionCall = data.candidates?.[0]?.content?.parts?.find(
    (part: { functionCall?: unknown }) => part.functionCall
  )?.functionCall;

  if (!functionCall || functionCall.name !== 'generate_map_blueprint') {
    throw new Error('Gemini did not return expected function call');
  }

  return { blueprint: functionCall.args as MapBlueprint };
}

// ============================================================================
// PROMPT BUILDING
// ============================================================================

function buildUserPrompt(settings: MapGenerationSettings, size: { width: number; height: number }): string {
  const lines: string[] = [
    `Create a ${settings.playerCount}-player competitive RTS map with the following specifications:`,
    '',
    `**Dimensions**: ${size.width}x${size.height} cells`,
    `**Biome**: ${settings.biome}`,
    `**Players**: ${settings.playerCount}`,
    '',
  ];

  if (settings.theme) {
    lines.push(`**Theme/Description**: ${settings.theme}`, '');
  }

  if (settings.islandMap) {
    lines.push(
      '**Map Type**: Island/Naval map',
      '- Use deep water to separate land masses',
      '- Create island bases connected by shallow water crossings or bridges',
      '- Consider naval gameplay with water-based choke points',
      ''
    );
  } else if (settings.includeWater) {
    lines.push(
      '**Water Features**: Include water features',
      '- Use shallow water for strategic slow zones',
      '- Deep water for lakes or map boundaries',
      ''
    );
  }

  if (settings.includeForests) {
    lines.push(
      '**Forests**: Include forest areas',
      '- Place forests for vision blocking and ambush opportunities',
      '- Avoid blocking key paths or base locations',
      ''
    );
  }

  if (settings.borderStyle !== 'none') {
    lines.push(
      `**Border Style**: ${settings.borderStyle}`,
      `- Create imposing ${settings.borderStyle} walls around map edges`,
      '- Use high density (0.7-0.9) for solid visual boundary',
      ''
    );
  }

  lines.push(
    '**Requirements**:',
    '1. Create balanced, symmetric spawn positions',
    '2. Each player needs: main base (HIGH), natural (MID), third expansion',
    '3. Include ramps connecting elevation changes',
    '4. Add watch towers at strategic neutral locations',
    '5. Consider destructible rocks for alternate paths',
    '6. Ensure natural flow from main → natural → third → center',
  );

  return lines.join('\n');
}

// ============================================================================
// MAIN GENERATION FUNCTION
// ============================================================================

/**
 * Generate a map using the specified LLM provider
 */
export async function generateMapWithLLM(
  config: LLMConfig,
  settings: MapGenerationSettings
): Promise<GenerationResult> {
  try {
    // Call the appropriate provider
    let result: ToolCallResult;

    switch (config.provider) {
      case 'claude':
        result = await callClaude(config, settings);
        break;
      case 'openai':
        result = await callOpenAI(config, settings);
        break;
      case 'gemini':
        result = await callGemini(config, settings);
        break;
      default:
        throw new Error(`Unknown provider: ${config.provider}`);
    }

    // Validate and fix the blueprint
    const blueprint = validateAndFixBlueprint(result.blueprint, settings);

    // Generate the full map data
    const mapData = generateMap(blueprint);

    return {
      success: true,
      mapData,
      blueprint,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred',
      rawResponse: error,
    };
  }
}

// Elevation constants for base generation
const ELEVATION_HIGH = 220; // Main base level
const ELEVATION_MID = 140;  // Natural expansion level
const ELEVATION_LOW = 60;   // Ground level

/**
 * Check if a plateau command exists near a given position
 */
function hasPlateauNear(
  paint: MapBlueprint['paint'],
  x: number,
  y: number,
  minElevation: number
): boolean {
  return paint.some(cmd => {
    if (cmd.cmd === 'plateau') {
      const dx = cmd.x - x;
      const dy = cmd.y - y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      // Consider it covered if a plateau is within its radius distance and has sufficient elevation
      return dist < cmd.radius && cmd.elevation >= minElevation;
    }
    if (cmd.cmd === 'rect') {
      // Check if point is inside rect with sufficient elevation
      const inX = x >= cmd.x && x <= cmd.x + cmd.width;
      const inY = y >= cmd.y && y <= cmd.y + cmd.height;
      return inX && inY && cmd.elevation >= minElevation;
    }
    return false;
  });
}

/**
 * Check if a ramp command exists between two approximate positions
 */
function hasRampBetween(
  paint: MapBlueprint['paint'],
  x1: number,
  y1: number,
  x2: number,
  y2: number
): boolean {
  return paint.some(cmd => {
    if (cmd.cmd !== 'ramp') return false;

    // Normalize ramp endpoints
    const from = Array.isArray(cmd.from) ? { x: cmd.from[0], y: cmd.from[1] } : cmd.from;
    const to = Array.isArray(cmd.to) ? { x: cmd.to[0], y: cmd.to[1] } : cmd.to;

    // Check if ramp is roughly between our two points (within tolerance)
    const tolerance = 30;
    const rampNearStart =
      (Math.abs(from.x - x1) < tolerance && Math.abs(from.y - y1) < tolerance) ||
      (Math.abs(from.x - x2) < tolerance && Math.abs(from.y - y2) < tolerance);
    const rampNearEnd =
      (Math.abs(to.x - x1) < tolerance && Math.abs(to.y - y1) < tolerance) ||
      (Math.abs(to.x - x2) < tolerance && Math.abs(to.y - y2) < tolerance);

    return rampNearStart || rampNearEnd;
  });
}

/**
 * Calculate midpoint between two positions, offset toward natural
 */
function calculateRampPosition(
  mainX: number,
  mainY: number,
  natX: number,
  natY: number
): { fromX: number; fromY: number; toX: number; toY: number } {
  // Ramp goes FROM high ground (main) TO low ground (natural direction)
  const dx = natX - mainX;
  const dy = natY - mainY;
  const dist = Math.sqrt(dx * dx + dy * dy);

  if (dist === 0) {
    return { fromX: mainX, fromY: mainY, toX: natX, toY: natY };
  }

  // Normalize direction
  const nx = dx / dist;
  const ny = dy / dist;

  // Ramp starts at edge of main plateau (radius ~22) and ends partway to natural
  const rampStart = 20;
  const rampLength = Math.min(dist * 0.4, 25); // 40% of distance or max 25 cells

  return {
    fromX: Math.round(mainX + nx * rampStart),
    fromY: Math.round(mainY + ny * rampStart),
    toX: Math.round(mainX + nx * (rampStart + rampLength)),
    toY: Math.round(mainY + ny * (rampStart + rampLength)),
  };
}

/**
 * Validate and fix common issues with LLM-generated blueprints
 */
function validateAndFixBlueprint(
  blueprint: MapBlueprint,
  settings: MapGenerationSettings
): MapBlueprint {
  const fixed = { ...blueprint };
  const size = MAP_SIZES[settings.mapSize];

  // Ensure canvas dimensions match settings
  fixed.canvas = {
    ...fixed.canvas,
    width: size.width,
    height: size.height,
    biome: settings.biome,
  };

  // Ensure meta has required fields
  fixed.meta = {
    id: fixed.meta?.id || `ai_map_${Date.now()}`,
    name: fixed.meta?.name || 'AI Generated Map',
    author: 'AI Generator',
    description: fixed.meta?.description || settings.theme || 'AI-generated competitive map',
    players: settings.playerCount,
  };

  // Ensure paint array starts with fill
  if (!fixed.paint || fixed.paint.length === 0) {
    fixed.paint = [{ cmd: 'fill', elevation: ELEVATION_LOW }];
  } else if (fixed.paint[0].cmd !== 'fill') {
    fixed.paint = [{ cmd: 'fill', elevation: ELEVATION_LOW }, ...fixed.paint];
  }

  // Ensure border command exists
  const hasBorder = fixed.paint.some(cmd => cmd.cmd === 'border');
  if (!hasBorder) {
    fixed.paint.push({ cmd: 'border', thickness: 12 });
  }

  // Ensure bases array exists
  if (!fixed.bases || fixed.bases.length === 0) {
    debugInitialization.warn('LLM did not generate bases - this will need manual placement');
    fixed.bases = [];
  }

  // ============================================================================
  // AUTO-GENERATE ELEVATION AND RAMPS FOR BASES
  // ============================================================================

  // Group bases by player slot
  const mainBases = fixed.bases.filter(b => b.type === 'main' && b.playerSlot !== undefined);
  const naturalBases = fixed.bases.filter(b => b.type === 'natural');

  // Commands to insert (after fill, before border)
  const elevationCommands: MapBlueprint['paint'] = [];
  const rampCommands: MapBlueprint['paint'] = [];

  // For each main base, ensure HIGH elevation plateau exists
  for (const main of mainBases) {
    if (!hasPlateauNear(fixed.paint, main.x, main.y, ELEVATION_HIGH)) {
      elevationCommands.push({
        cmd: 'plateau',
        x: main.x,
        y: main.y,
        radius: 22,
        elevation: ELEVATION_HIGH,
      });
    }
  }

  // For each natural base, ensure MID elevation plateau exists
  for (const natural of naturalBases) {
    if (!hasPlateauNear(fixed.paint, natural.x, natural.y, ELEVATION_MID)) {
      elevationCommands.push({
        cmd: 'plateau',
        x: natural.x,
        y: natural.y,
        radius: 18,
        elevation: ELEVATION_MID,
      });
    }
  }

  // For each main base, find closest natural and create ramp if needed
  for (const main of mainBases) {
    // Find the closest natural base
    let closestNatural: (typeof naturalBases)[0] | null = null;
    let closestDist = Infinity;

    for (const natural of naturalBases) {
      const dx = natural.x - main.x;
      const dy = natural.y - main.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < closestDist) {
        closestDist = dist;
        closestNatural = natural;
      }
    }

    // Create ramp if natural exists and no ramp exists
    if (closestNatural && closestDist < 80) {
      if (!hasRampBetween(fixed.paint, main.x, main.y, closestNatural.x, closestNatural.y)) {
        const { fromX, fromY, toX, toY } = calculateRampPosition(
          main.x,
          main.y,
          closestNatural.x,
          closestNatural.y
        );

        rampCommands.push({
          cmd: 'ramp',
          from: [fromX, fromY],
          to: [toX, toY],
          width: 10,
        });
      }
    }
  }

  // Insert elevation commands after fill but before other terrain commands
  // Insert ramps after elevation commands
  if (elevationCommands.length > 0 || rampCommands.length > 0) {
    // Find border index
    const borderIndex = fixed.paint.findIndex(cmd => cmd.cmd === 'border');
    const insertIndex = borderIndex > 0 ? borderIndex : fixed.paint.length;

    // Insert elevation first, then ramps (order matters - ramps read elevation)
    fixed.paint.splice(insertIndex, 0, ...elevationCommands, ...rampCommands);
  }

  // ============================================================================
  // DECORATION RULES
  // ============================================================================

  // Ensure decoration rules exist with appropriate border
  if (!fixed.decorationRules) {
    fixed.decorationRules = {};
  }

  if (settings.borderStyle !== 'none' && !fixed.decorationRules.border) {
    fixed.decorationRules.border = {
      style: settings.borderStyle as DecorationStyle,
      density: 0.75,
      scale: [1.5, 3.0],
      innerOffset: 15,
      outerOffset: 5,
    };
  }

  // Add default scatter and baseRings if missing
  if (!fixed.decorationRules.scatter) {
    fixed.decorationRules.scatter = {
      rocks: 0.15,
      debris: 0.1,
    };
  }

  if (!fixed.decorationRules.baseRings) {
    fixed.decorationRules.baseRings = {
      rocks: 12,
      trees: 8,
    };
  }

  // Add random seed if missing
  if (fixed.decorationRules.seed === undefined) {
    fixed.decorationRules.seed = Math.floor(Math.random() * 10000);
  }

  return fixed;
}

// ============================================================================
// API KEY STORAGE
// ============================================================================

const API_KEY_STORAGE_PREFIX = 'voidstrike_llm_key_';

/**
 * Store API key in session storage
 */
export function storeApiKey(provider: LLMProvider, apiKey: string): void {
  if (typeof window !== 'undefined') {
    sessionStorage.setItem(`${API_KEY_STORAGE_PREFIX}${provider}`, apiKey);
  }
}

/**
 * Retrieve API key from session storage
 */
export function getStoredApiKey(provider: LLMProvider): string | null {
  if (typeof window !== 'undefined') {
    return sessionStorage.getItem(`${API_KEY_STORAGE_PREFIX}${provider}`);
  }
  return null;
}

/**
 * Clear stored API key
 */
export function clearApiKey(provider: LLMProvider): void {
  if (typeof window !== 'undefined') {
    sessionStorage.removeItem(`${API_KEY_STORAGE_PREFIX}${provider}`);
  }
}

/**
 * Test API key validity with a minimal request
 */
export async function testApiKey(provider: LLMProvider, apiKey: string): Promise<boolean> {
  try {
    switch (provider) {
      case 'claude': {
        const response = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
            'anthropic-dangerous-direct-browser-access': 'true',
          },
          body: JSON.stringify({
            model: 'claude-sonnet-4-20250514',
            max_tokens: 1,
            messages: [{ role: 'user', content: 'Hi' }],
          }),
        });
        return response.ok || response.status === 400; // 400 = valid key but bad request
      }
      case 'openai': {
        const response = await fetch('https://api.openai.com/v1/models', {
          headers: { 'Authorization': `Bearer ${apiKey}` },
        });
        return response.ok;
      }
      case 'gemini': {
        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`
        );
        return response.ok;
      }
      default:
        return false;
    }
  } catch {
    return false;
  }
}
