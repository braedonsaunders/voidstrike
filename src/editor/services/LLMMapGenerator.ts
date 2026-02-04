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
  ResourceDirection,
} from '@/data/maps/core/ElevationMap';
import { generateMap } from '@/data/maps/core/ElevationMapGenerator';
import type { MapData } from '@/data/maps/MapTypes';
import {
  createBaseResources,
  DIR,
  MINERAL_DISTANCE_NATURAL,
} from '@/data/maps/MapTypes';

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
      '**Map Type**: Island/Naval map - CRITICAL INSTRUCTIONS:',
      '',
      'Paint order (THIS ORDER IS MANDATORY):',
      '1. fill(60) - base ground level',
      '2. plateau commands for EACH base location (radius 35+ for mains, 25+ for naturals)',
      '3. THEN water commands to fill spaces BETWEEN islands',
      '4. border command last',
      '',
      'Island requirements:',
      '- Main base islands: radius 35-40 at HIGH elevation (220)',
      '- Natural islands: radius 25-30 at MID elevation (140)',
      '- Third/Gold base islands: radius 20-25 at LOW elevation (60)',
      '- Water goes AROUND the islands, not on them',
      '- Connect islands with shallow water crossings (walkable) or ramps',
      '- CRITICAL: Each island base MUST have a ramp from its plateau down to beach level (LOW elevation)',
      '  so units can access the shore and shallow water crossings',
      '',
      'Water layering (for ocean between islands):',
      '- Paint shallow water FIRST covering ocean area',
      '- Paint deep water on TOP (smaller area in center of ocean)',
      '- Shallow water forms walkable shores/crossings',
      ''
    );
  } else if (settings.includeWater) {
    lines.push(
      '**Water Features**: Include lakes, rivers, or ponds',
      '',
      'CRITICAL: Place water AWAY from bases',
      '- Keep at least 30 cells between water and main bases',
      '- Keep at least 20 cells between water and natural bases',
      '- Water is for map obstacles, not base areas',
      '',
      'Water layering:',
      '  1. Paint shallow water FIRST (larger area for shoreline)',
      '  2. Paint deep water on TOP (smaller, in center)',
      '- Shore width should be 5-8 cells',
      ''
    );
  } else {
    // Explicit instruction: NO water
    lines.push(
      '**Water**: DO NOT include any water features. This is a land-only map.',
      '- Use elevation changes, forests, void areas, and rocks for terrain variety instead',
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
    '3. Include ramps connecting elevation changes:',
    '   - Main to natural (required)',
    '   - Natural to third base area (required)',
    '   - Third to center/contested areas',
    '4. Add watch towers at strategic neutral locations',
    '5. Consider destructible rocks for alternate paths',
    '6. Ensure natural flow from main → natural → third → center',
    '',
    '**Map Variety**:',
    '- Create a unique, interesting layout - avoid generic symmetric patterns',
    '- Consider asymmetric elements that are still competitively balanced',
    '- Vary elevation patterns - not everything needs to be a simple plateau',
    '- Add interesting terrain features that create strategic decisions',
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

    // Skip malformed ramp commands missing from/to
    if (!cmd.from || !cmd.to) {
      debugInitialization.warn('Skipping malformed ramp command missing from/to:', cmd);
      return false;
    }

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

// ============================================================================
// MINERAL PLACEMENT VALIDATION
// ============================================================================

/** All possible mineral directions */
const ALL_MINERAL_DIRECTIONS: ResourceDirection[] = [
  'up', 'down', 'left', 'right',
  'up_left', 'up_right', 'down_left', 'down_right',
];

/** Convert ResourceDirection string to radians */
function directionToRadians(dir: ResourceDirection): number {
  switch (dir) {
    case 'up': return DIR.UP;
    case 'down': return DIR.DOWN;
    case 'left': return DIR.LEFT;
    case 'right': return DIR.RIGHT;
    case 'up_left': return DIR.UP_LEFT;
    case 'up_right': return DIR.UP_RIGHT;
    case 'down_left': return DIR.DOWN_LEFT;
    case 'down_right': return DIR.DOWN_RIGHT;
    default: return DIR.DOWN;
  }
}

/** Minimum buildable radius around mineral center */
const MIN_MINERAL_BUILDABLE_RADIUS = 12;

/**
 * Get all mineral and geyser positions for a base with given direction
 */
function getMineralPositions(
  baseX: number,
  baseY: number,
  direction: ResourceDirection,
  isNatural: boolean
): Array<{ x: number; y: number }> {
  const dirRadians = directionToRadians(direction);
  const mineralDistance = isNatural ? MINERAL_DISTANCE_NATURAL : 7;
  const resources = createBaseResources(baseX, baseY, dirRadians, 1500, 2250, false, mineralDistance);

  const positions: Array<{ x: number; y: number }> = [];
  for (const mineral of resources.minerals) {
    positions.push({ x: mineral.x, y: mineral.y });
  }
  for (const plasma of resources.plasma) {
    positions.push({ x: plasma.x, y: plasma.y });
  }

  // Also include the mineral center for space validation
  const mineralCenterX = baseX + Math.cos(dirRadians) * mineralDistance;
  const mineralCenterY = baseY + Math.sin(dirRadians) * mineralDistance;
  positions.push({ x: mineralCenterX, y: mineralCenterY });

  return positions;
}

/**
 * Check if a position is inside a water or void feature
 */
function isPositionInWaterOrVoid(
  x: number,
  y: number,
  paintCommands: MapBlueprint['paint']
): boolean {
  for (const cmd of paintCommands) {
    if (cmd.cmd === 'water' || cmd.cmd === 'void') {
      if (cmd.radius !== undefined) {
        // Circular water/void
        const dx = x - cmd.x;
        const dy = y - cmd.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist <= cmd.radius) {
          return true;
        }
      } else if (cmd.width !== undefined && cmd.height !== undefined) {
        // Rectangular water/void
        if (x >= cmd.x && x <= cmd.x + cmd.width &&
            y >= cmd.y && y <= cmd.y + cmd.height) {
          return true;
        }
      }
    }
  }
  return false;
}

/**
 * Find the direction to the nearest water from a base position.
 * Returns normalized direction vector or null if no water nearby.
 */
function findNearestWaterDirection(
  baseX: number,
  baseY: number,
  baseRadius: number,
  paintCommands: MapBlueprint['paint'],
  mapSize: { width: number; height: number }
): { dx: number; dy: number } | null {
  // Sample in 8 directions to find nearest water
  const directions = [
    { dx: 0, dy: -1 },   // up
    { dx: 1, dy: -1 },   // up-right
    { dx: 1, dy: 0 },    // right
    { dx: 1, dy: 1 },    // down-right
    { dx: 0, dy: 1 },    // down
    { dx: -1, dy: 1 },   // down-left
    { dx: -1, dy: 0 },   // left
    { dx: -1, dy: -1 },  // up-left
  ];

  let nearestDir: { dx: number; dy: number } | null = null;
  let nearestDist = Infinity;

  for (const dir of directions) {
    // Check points along this direction from base edge
    for (let dist = baseRadius + 5; dist < 80; dist += 5) {
      const checkX = baseX + dir.dx * dist;
      const checkY = baseY + dir.dy * dist;

      // Skip if out of bounds
      if (checkX < 0 || checkX >= mapSize.width || checkY < 0 || checkY >= mapSize.height) {
        break;
      }

      // Check if this point is in water
      if (isPositionInWaterOrVoid(checkX, checkY, paintCommands)) {
        if (dist < nearestDist) {
          nearestDist = dist;
          nearestDir = dir;
        }
        break;
      }
    }
  }

  return nearestDir;
}

/**
 * Check if a circular area overlaps with water (any overlap, not just center)
 */
function doesCircleOverlapWater(
  x: number,
  y: number,
  radius: number,
  paintCommands: MapBlueprint['paint']
): boolean {
  for (const cmd of paintCommands) {
    if (cmd.cmd === 'water') {
      if (cmd.radius !== undefined) {
        // Circle-circle intersection
        const dx = x - cmd.x;
        const dy = y - cmd.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < radius + cmd.radius) {
          return true;
        }
      } else if (cmd.width !== undefined && cmd.height !== undefined) {
        // Circle-rect intersection
        const closestX = Math.max(cmd.x, Math.min(x, cmd.x + cmd.width));
        const closestY = Math.max(cmd.y, Math.min(y, cmd.y + cmd.height));
        const dx = x - closestX;
        const dy = y - closestY;
        if (dx * dx + dy * dy < radius * radius) {
          return true;
        }
      }
    }
  }
  return false;
}

/** Minimum land radius requirements for base types */
const MIN_LAND_RADIUS = {
  main: 35,     // Main bases need largest area
  natural: 25,  // Naturals need medium area
  third: 20,    // Expansion bases need smaller area
  fourth: 20,
  fifth: 20,
  gold: 20,
  pocket: 18,
} as const;

/** Get required elevation for base type */
function getBaseElevation(type: string): number {
  switch (type) {
    case 'main':
      return ELEVATION_HIGH;
    case 'natural':
      return ELEVATION_MID;
    default:
      return ELEVATION_LOW;
  }
}

/**
 * Check if minerals would be placed in water/void with given direction
 */
function checkMineralsInWater(
  baseX: number,
  baseY: number,
  direction: ResourceDirection,
  isNatural: boolean,
  paintCommands: MapBlueprint['paint']
): boolean {
  const positions = getMineralPositions(baseX, baseY, direction, isNatural);

  for (const pos of positions) {
    if (isPositionInWaterOrVoid(pos.x, pos.y, paintCommands)) {
      return true; // Found minerals in water
    }
  }

  return false;
}

/**
 * Check if there's sufficient buildable space around minerals
 * Returns the percentage of cells within radius that are NOT water/void
 */
function checkMineralSpaceAvailable(
  baseX: number,
  baseY: number,
  direction: ResourceDirection,
  isNatural: boolean,
  paintCommands: MapBlueprint['paint'],
  radius: number = MIN_MINERAL_BUILDABLE_RADIUS
): number {
  const dirRadians = directionToRadians(direction);
  const mineralDistance = isNatural ? MINERAL_DISTANCE_NATURAL : 7;
  const mineralCenterX = baseX + Math.cos(dirRadians) * mineralDistance;
  const mineralCenterY = baseY + Math.sin(dirRadians) * mineralDistance;

  let totalCells = 0;
  let clearCells = 0;

  // Sample points in the circular area around mineral center
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist <= radius) {
        totalCells++;
        const px = mineralCenterX + dx;
        const py = mineralCenterY + dy;
        if (!isPositionInWaterOrVoid(px, py, paintCommands)) {
          clearCells++;
        }
      }
    }
  }

  return totalCells > 0 ? clearCells / totalCells : 0;
}

/**
 * Find a valid mineral direction for a base that avoids water/void
 * Returns the best direction, or null if none are suitable
 */
function findValidMineralDirection(
  baseX: number,
  baseY: number,
  preferredDirection: ResourceDirection | undefined,
  isNatural: boolean,
  paintCommands: MapBlueprint['paint']
): { direction: ResourceDirection; clearPercent: number } | null {
  // Start with preferred direction, then try others
  const directionsToTry: ResourceDirection[] = preferredDirection
    ? [preferredDirection, ...ALL_MINERAL_DIRECTIONS.filter(d => d !== preferredDirection)]
    : ALL_MINERAL_DIRECTIONS;

  let bestDirection: ResourceDirection | null = null;
  let bestClearPercent = 0;

  for (const dir of directionsToTry) {
    // Skip if minerals would be directly in water
    if (checkMineralsInWater(baseX, baseY, dir, isNatural, paintCommands)) {
      continue;
    }

    // Check space availability
    const clearPercent = checkMineralSpaceAvailable(baseX, baseY, dir, isNatural, paintCommands);

    // Need at least 80% clear space
    if (clearPercent >= 0.8) {
      return { direction: dir, clearPercent };
    }

    // Track best option in case none meet threshold
    if (clearPercent > bestClearPercent) {
      bestClearPercent = clearPercent;
      bestDirection = dir;
    }
  }

  // Return best option if we have one with at least 50% space
  if (bestDirection && bestClearPercent >= 0.5) {
    return { direction: bestDirection, clearPercent: bestClearPercent };
  }

  return null;
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

  // Filter out malformed ramp commands (missing from/to coordinates)
  const malformedRamps = fixed.paint.filter(cmd => cmd.cmd === 'ramp' && (!cmd.from || !cmd.to));
  if (malformedRamps.length > 0) {
    debugInitialization.warn(`Removing ${malformedRamps.length} malformed ramp command(s) missing from/to coordinates`);
    fixed.paint = fixed.paint.filter(cmd => !(cmd.cmd === 'ramp' && (!cmd.from || !cmd.to)));
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

  // Group bases by type
  const mainBases = fixed.bases.filter(b => b.type === 'main' && b.playerSlot !== undefined);
  const naturalBases = fixed.bases.filter(b => b.type === 'natural');
  const thirdBases = fixed.bases.filter(b => b.type === 'third');
  const otherBases = fixed.bases.filter(b => b.type === 'fourth' || b.type === 'gold');

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

  // For each natural base, find closest third base and create ramp if needed
  for (const natural of naturalBases) {
    // Find the closest third base (or other expansion if no third exists)
    const expansionTargets = thirdBases.length > 0 ? thirdBases : otherBases;
    let closestThird: (typeof thirdBases)[0] | null = null;
    let closestDist = Infinity;

    for (const third of expansionTargets) {
      const dx = third.x - natural.x;
      const dy = third.y - natural.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < closestDist) {
        closestDist = dist;
        closestThird = third;
      }
    }

    // Create ramp if third exists, within reasonable distance, and no ramp exists
    if (closestThird && closestDist < 100) {
      if (!hasRampBetween(fixed.paint, natural.x, natural.y, closestThird.x, closestThird.y)) {
        // Calculate ramp from natural to third
        const { fromX, fromY, toX, toY } = calculateRampPosition(
          natural.x,
          natural.y,
          closestThird.x,
          closestThird.y
        );

        rampCommands.push({
          cmd: 'ramp',
          from: [fromX, fromY],
          to: [toX, toY],
          width: 12, // Slightly wider for natural-to-third ramps
        });

        debugInitialization.log(
          `Auto-generated ramp from natural at (${natural.x}, ${natural.y}) to third at (${closestThird.x}, ${closestThird.y})`
        );
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
  // ENSURE BASES HAVE ADEQUATE LAND (FIX REVERSED ISLAND MAPS)
  // ============================================================================

  // Check each base and ensure it has solid land underneath
  const landPlateauCommands: MapBlueprint['paint'] = [];

  for (const base of fixed.bases) {
    const requiredRadius = MIN_LAND_RADIUS[base.type as keyof typeof MIN_LAND_RADIUS] || 20;
    const requiredElevation = getBaseElevation(base.type);

    // Check if the base center is in water
    const baseInWater = isPositionInWaterOrVoid(base.x, base.y, fixed.paint);

    // Check if the required land area overlaps with water
    const landOverlapsWater = doesCircleOverlapWater(base.x, base.y, requiredRadius, fixed.paint);

    if (baseInWater || landOverlapsWater) {
      // Base is in water or doesn't have enough land - add a plateau to create land
      // This plateau will be painted AFTER water, overwriting it with land
      debugInitialization.warn(
        `Base at (${base.x}, ${base.y}) type='${base.type}' is in water or lacks adequate land. ` +
        `Adding land plateau with radius ${requiredRadius}.`
      );

      landPlateauCommands.push({
        cmd: 'plateau',
        x: base.x,
        y: base.y,
        radius: requiredRadius,
        elevation: requiredElevation,
      });
    }
  }

  // Insert land plateaus AFTER water commands but BEFORE border
  // This ensures land is painted over water where bases need to be
  if (landPlateauCommands.length > 0) {
    const borderIndex = fixed.paint.findIndex(cmd => cmd.cmd === 'border');
    const insertIndex = borderIndex > 0 ? borderIndex : fixed.paint.length;
    fixed.paint.splice(insertIndex, 0, ...landPlateauCommands);
  }

  // ============================================================================
  // FILTER OUT WATER COMMANDS THAT COMPLETELY OVERLAP WITH BASES
  // ============================================================================

  // Build list of base protection zones
  const baseProtectionZones = fixed.bases.map(base => ({
    x: base.x,
    y: base.y,
    radius: MIN_LAND_RADIUS[base.type as keyof typeof MIN_LAND_RADIUS] || 20,
  }));

  // Remove water commands that are entirely within a base protection zone
  fixed.paint = fixed.paint.filter(cmd => {
    if (cmd.cmd !== 'water') return true;

    // Check if this water command is entirely inside any base zone
    for (const zone of baseProtectionZones) {
      if (cmd.radius !== undefined) {
        // Circular water - check if completely inside base zone
        const dx = cmd.x - zone.x;
        const dy = cmd.y - zone.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        // If the entire water circle is inside the base zone, remove it
        if (dist + cmd.radius < zone.radius) {
          debugInitialization.warn(
            `Removing water at (${cmd.x}, ${cmd.y}) r=${cmd.radius} - entirely within base zone`
          );
          return false;
        }
      }
    }

    return true;
  });

  // ============================================================================
  // BEACH ACCESS RAMPS FOR ISLAND MAPS
  // ============================================================================

  // For island maps, ensure bases on elevated terrain have ramps down to beach level
  if (settings.islandMap) {
    const beachAccessRamps: MapBlueprint['paint'] = [];

    for (const base of fixed.bases) {
      // Only process main and natural bases on elevated terrain
      if (base.type !== 'main' && base.type !== 'natural') continue;

      const baseElevation = getBaseElevation(base.type);
      if (baseElevation <= ELEVATION_LOW) continue; // Already at beach level

      const baseRadius = MIN_LAND_RADIUS[base.type as keyof typeof MIN_LAND_RADIUS] || 20;

      // Find the direction to the nearest water
      const waterDirection = findNearestWaterDirection(base.x, base.y, baseRadius, fixed.paint, size);

      if (waterDirection) {
        // Check if a beach access ramp already exists in this direction
        const beachX = base.x + waterDirection.dx * (baseRadius + 10);
        const beachY = base.y + waterDirection.dy * (baseRadius + 10);

        if (!hasRampBetween(fixed.paint, base.x, base.y, beachX, beachY) &&
            !hasRampBetween(beachAccessRamps, base.x, base.y, beachX, beachY)) {
          // Calculate beach access ramp position
          const rampStart = baseRadius - 5; // Start just inside plateau edge
          const rampLength = 15; // Length to reach beach level

          const fromX = Math.round(base.x + waterDirection.dx * rampStart);
          const fromY = Math.round(base.y + waterDirection.dy * rampStart);
          const toX = Math.round(base.x + waterDirection.dx * (rampStart + rampLength));
          const toY = Math.round(base.y + waterDirection.dy * (rampStart + rampLength));

          beachAccessRamps.push({
            cmd: 'ramp',
            from: [fromX, fromY],
            to: [toX, toY],
            width: 8, // Narrower beach access ramp
          });

          debugInitialization.log(
            `Auto-generated beach access ramp for ${base.type} at (${base.x}, ${base.y}) toward water`
          );
        }
      }
    }

    // Insert beach access ramps
    if (beachAccessRamps.length > 0) {
      const borderIndex = fixed.paint.findIndex(cmd => cmd.cmd === 'border');
      const insertIndex = borderIndex > 0 ? borderIndex : fixed.paint.length;
      fixed.paint.splice(insertIndex, 0, ...beachAccessRamps);
    }
  }

  // ============================================================================
  // VALIDATE AND FIX MINERAL PLACEMENT
  // ============================================================================

  // Check each base's mineral placement against water/void features
  for (const base of fixed.bases) {
    const isNatural = base.type === 'natural';
    const currentDirection = base.mineralDirection || 'down';

    // Check if current mineral direction would place minerals in water/void
    const inWater = checkMineralsInWater(base.x, base.y, currentDirection, isNatural, fixed.paint);
    const clearPercent = checkMineralSpaceAvailable(base.x, base.y, currentDirection, isNatural, fixed.paint);

    if (inWater || clearPercent < 0.8) {
      // Try to find a better direction
      const validResult = findValidMineralDirection(
        base.x,
        base.y,
        currentDirection,
        isNatural,
        fixed.paint
      );

      if (validResult) {
        if (validResult.direction !== currentDirection) {
          debugInitialization.warn(
            `Base at (${base.x}, ${base.y}) minerals rotated from '${currentDirection}' to '${validResult.direction}' to avoid water/void`
          );
          base.mineralDirection = validResult.direction;
        }
        if (validResult.clearPercent < 0.8) {
          debugInitialization.warn(
            `Base at (${base.x}, ${base.y}) has limited buildable space around minerals (${Math.round(validResult.clearPercent * 100)}% clear)`
          );
        }
      } else {
        // No valid direction found - warn user
        debugInitialization.warn(
          `WARNING: Base at (${base.x}, ${base.y}) cannot place minerals without overlapping water/void. ` +
          `Consider moving this base or adjusting nearby water features.`
        );
      }
    }
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

  // ============================================================================
  // FILTER EXPLICIT DECORATIONS IN WATER
  // ============================================================================

  // Remove any explicit decorations that were placed in water bodies
  if (fixed.explicitDecorations && fixed.explicitDecorations.length > 0) {
    const originalCount = fixed.explicitDecorations.length;

    fixed.explicitDecorations = fixed.explicitDecorations.filter(deco => {
      const inWater = isPositionInWaterOrVoid(deco.x, deco.y, fixed.paint);
      if (inWater) {
        debugInitialization.warn(
          `Removing decoration '${deco.type}' at (${deco.x}, ${deco.y}) - placed in water/void`
        );
        return false;
      }
      return true;
    });

    const removedCount = originalCount - fixed.explicitDecorations.length;
    if (removedCount > 0) {
      debugInitialization.warn(
        `Removed ${removedCount} decoration(s) that were placed in water/void areas`
      );
    }
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
