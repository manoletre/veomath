import OpenAI from 'openai';
import { NextRequest, NextResponse } from 'next/server';
import { MANIM_SYSTEM_PROMPT } from '../shared/systemPrompt';
import { generateAndIterateSlide, SlideSpec } from '../shared/animationIterator';
import { meteredOpenAI, recordPrompt, requireUser, securityError, publicError, RequestError } from '../../lib/server-security';
import { getDb } from '../../lib/firebase-admin';
import { readJson, validateAgentic } from '../../lib/request-validation';

const PLAN_SYSTEM_PROMPT = `You are a mathematics explainer that plans interactive visual documents.

Given a topic, produce a document outline that alternates short text snippets with interactive slide descriptions. The document should read like a casual, friendly explanation — as if walking someone through the idea on a whiteboard.

Rules:
- Start with a single motivating sentence.
- Between each slide, write 1–2 short bridge sentences that set up what the next slide shows. Keep language simple and conversational — a smart high-schooler should understand.
- Each slide description should specify exactly what interactive visualization to build (what shapes, what's draggable/interactive, what the user can explore).
- Aim for 3–5 slides total. More is fine if the topic warrants it, but don't pad.
- The whole document should tell a coherent story from motivation to conclusion.
- Do NOT write long paragraphs. Every text item is 1–2 sentences max.`;

const GENERATE_TEXT_SYSTEM_PROMPT = `You are a mathematics visualization assistant that creates interactive explainer documents using manim-web.

You will receive a document plan (alternating text and slide items). Generate ONLY the text items — revise wording lightly for flow but keep them to 1–2 short sentences each. You do NOT need to generate manim code; slides will be handled separately.`;

const REGENERATE_SYSTEM_PROMPT = `You are a mathematics visualization assistant. You need to regenerate a single interactive slide based on user feedback.

${MANIM_SYSTEM_PROMPT}

You will receive:
- The topic of the overall explainer
- The slide title and description
- The user's comment/feedback on what to change
- Context about what comes before and after this slide in the document

Generate improved manim-web JavaScript code for this single slide. The code is STANDALONE — it gets its own scene.`;

export async function POST(request: NextRequest) {
  const user = await requireUser(request);
  if (user instanceof NextResponse) return user;
  try {
    const body = validateAgentic(await readJson(request, 500000));
    const { mode } = body;
    if (body.fileId) {
      const file = await getDb().doc(`users/${user.uid}/uploads/${body.fileId}`).get();
      if (!file.exists) throw new RequestError('PDF not found for this account', 403);
    }
    const prompt = JSON.stringify({
      topic: body.topic, fileId: body.fileId,
      userComments: body.userComments, userComment: body.userComment, overallFeedback: body.overallFeedback,
      items: body.items, slideComments: body.slideComments,
      slideTitle: body.slideTitle, slideDescription: body.slideDescription,
      comments: body.lessonContext?.map(item => item.comment),
    });
    await recordPrompt(user.uid, mode, prompt, body.sessionId);
    const openai = meteredOpenAI(user.uid);

    if (mode === 'plan') {
      return await handlePlan(openai, body);
    } else if (mode === 'plan-from-pdf') {
      return await handlePlanFromPdf(openai, { fileId: body.fileId! });
    } else if (mode === 'generate') {
      return await handleGenerate(openai, body);
    } else if (mode === 'regenerate-slide') {
      return await handleRegenerateSlide(openai, body);
    } else if (mode === 'regenerate-course') {
      return await handleRegenerateCourse(openai, body);
    }

    return NextResponse.json({ error: 'Invalid mode' }, { status: 400 });
  } catch (error) {
    return securityError(error, 'Failed to generate response');
  }
}

async function handlePlan(openai: OpenAI, body: { topic: string }) {
  const response = await openai.chat.completions.create({
    model: 'gpt-5.4',
    messages: [
      { role: 'system', content: PLAN_SYSTEM_PROMPT },
      { role: 'user', content: `Create an interactive explainer document plan for: ${body.topic}` },
    ],
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: 'explainer_plan',
        strict: true,
        schema: {
          type: 'object',
          properties: {
            sessionTitle: {
              type: 'string',
              description: 'Short title for this explainer (3-8 words)',
            },
            items: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  type: { type: 'string', enum: ['text', 'slide'] },
                  content: { type: 'string', description: 'For text items: the 1-2 sentence text. For slides: empty string.' },
                  title: { type: 'string', description: 'For slide items: the slide title. For text: empty string.' },
                  description: { type: 'string', description: 'For slide items: what the visualization should show. For text: empty string.' },
                },
                required: ['type', 'content', 'title', 'description'],
                additionalProperties: false,
              },
            },
          },
          required: ['sessionTitle', 'items'],
          additionalProperties: false,
        },
      },
    },
  });

  const content = JSON.parse(response.choices[0].message.content!);
  return NextResponse.json(content);
}

const PLAN_FROM_PDF_SYSTEM_PROMPT = `You are a mathematics explainer that plans interactive visual documents based on research papers.

You will receive a research paper (PDF). Read it carefully and produce a document outline that alternates short text snippets with interactive slide descriptions. The document should explain the key ideas from the paper clearly — as if walking someone through the concepts on a whiteboard.

Rules:
- Start with a single motivating sentence about the paper's main contribution.
- Between each slide, write 1–2 short bridge sentences that set up what the next slide shows. Keep language simple and conversational — a smart high-schooler should understand.
- Each slide description should specify exactly what interactive visualization to build (what shapes, what's draggable/interactive, what the user can explore).
- Aim for 3–5 slides total. More is fine if the paper warrants it, but don't pad.
- The whole document should tell a coherent story from motivation to conclusion.
- Do NOT write long paragraphs. Every text item is 1–2 sentences max.
- Ground ALL content strictly in the paper. Do not add claims or formulas not present in the paper.`;

async function handlePlanFromPdf(openai: OpenAI, body: { fileId: string }) {
  const response = await openai.responses.create({
    model: 'gpt-4o',
    input: [
      {
        role: 'system',
        content: PLAN_FROM_PDF_SYSTEM_PROMPT,
      },
      {
        role: 'user',
        content: [
          {
            type: 'input_file',
            file_id: body.fileId,
          },
          {
            type: 'input_text',
            text: 'Read this research paper and create an interactive explainer document plan based on its contents.',
          },
        ],
      },
    ],
    text: {
      format: {
        type: 'json_schema',
        name: 'explainer_plan',
        strict: true,
        schema: {
          type: 'object',
          properties: {
            sessionTitle: {
              type: 'string',
              description: 'Short title for this explainer (3-8 words)',
            },
            items: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  type: { type: 'string', enum: ['text', 'slide'] },
                  content: { type: 'string', description: 'For text items: the 1-2 sentence text. For slides: empty string.' },
                  title: { type: 'string', description: 'For slide items: the slide title. For text: empty string.' },
                  description: { type: 'string', description: 'For slide items: what the visualization should show. For text: empty string.' },
                },
                required: ['type', 'content', 'title', 'description'],
                additionalProperties: false,
              },
            },
          },
          required: ['sessionTitle', 'items'],
          additionalProperties: false,
        },
      },
    },
  });

  const textOutput = response.output.find(o => o.type === 'message');
  const textContent = textOutput?.content?.find(c => c.type === 'output_text')?.text;
  if (!textContent) throw new Error('No text output from plan-from-pdf');
  const content = JSON.parse(textContent);
  return NextResponse.json(content);
}

async function extractSlideContext(
  openai: OpenAI,
  fileId: string,
  slideTitle: string,
  slideDescription: string,
): Promise<string> {
  const response = await openai.responses.create({
    model: 'gpt-4o',
    input: [
      {
        role: 'system',
        content: 'You are a research paper analyst. Given a paper and a slide description, extract the specific content from the paper that is relevant to creating this visualization. Include exact formulas, definitions, theorems, data points, and any other details the animation creator would need to accurately represent this concept. Be thorough but focused — only include content relevant to this specific slide.',
      },
      {
        role: 'user',
        content: [
          {
            type: 'input_file',
            file_id: fileId,
          },
          {
            type: 'input_text',
            text: `Extract the relevant content from this paper for the following slide:\n\nSlide title: "${slideTitle}"\nSlide description: ${slideDescription}\n\nReturn the specific paper content (formulas, definitions, examples, data) needed to accurately create this visualization.`,
          },
        ],
      },
    ],
    text: {
      format: {
        type: 'json_schema',
        name: 'slide_context',
        strict: true,
        schema: {
          type: 'object',
          properties: {
            relevantContent: {
              type: 'string',
              description: 'The specific content from the paper relevant to this slide, including formulas, definitions, theorems, data points, and explanations.',
            },
          },
          required: ['relevantContent'],
          additionalProperties: false,
        },
      },
    },
  });

  const textOutput = response.output.find(o => o.type === 'message');
  const textContent = textOutput?.content?.find(c => c.type === 'output_text')?.text;
  if (!textContent) return '';
  try {
    const parsed = JSON.parse(textContent);
    return parsed.relevantContent || '';
  } catch {
    return '';
  }
}

function generateTextItems(
  openai: OpenAI,
  body: {
    topic: string;
    items: Array<{ type: string; content: string; title: string; description: string }>;
    userComments: string;
  },
  send: (event: Record<string, unknown>) => void,
) {
  const planSummary = body.items
    .map((item, i) => {
      if (item.type === 'text') return `[Text ${i}]: ${item.content}`;
      return `[Slide ${i}]: "${item.title}" — ${item.description}`;
    })
    .join('\n');

  send({ type: 'progress', stage: 'generating', message: 'Generating text sections...' });

  return openai.chat.completions.create({
    model: 'gpt-5.4',
    messages: [
      { role: 'system', content: GENERATE_TEXT_SYSTEM_PROMPT },
      {
        role: 'user',
        content: `Topic: ${body.topic}\n\nDocument plan:\n${planSummary}\n\n${body.userComments ? `User comments: ${body.userComments}\n` : ''}Generate the final text for each text item. Return them in the same order as the plan.`,
      },
    ],
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: 'text_items',
        strict: true,
        schema: {
          type: 'object',
          properties: {
            texts: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  planIndex: { type: 'number', description: 'The index of this item in the original plan' },
                  content: { type: 'string', description: 'The revised text content' },
                },
                required: ['planIndex', 'content'],
                additionalProperties: false,
              },
            },
          },
          required: ['texts'],
          additionalProperties: false,
        },
      },
    },
  });
}

function generateSlidesInParallel(
  openai: OpenAI,
  body: {
    topic: string;
    items: Array<{ type: string; content: string; title: string; description: string }>;
    slideComments?: Record<string, string>;
    fileId?: string;
  },
  textMap: Map<number, string>,
  send: (event: Record<string, unknown>) => void,
) {
  const slideItems = body.items
    .map((item, i) => ({ item, planIndex: i }))
    .filter(({ item }) => item.type === 'slide');

  const slidePromises = slideItems.map(({ item, planIndex }, si) => {
    const contextParts: string[] = [];
    for (let j = Math.max(0, planIndex - 2); j <= Math.min(body.items.length - 1, planIndex + 2); j++) {
      if (body.items[j].type === 'text') {
        contextParts.push(textMap.get(j) || body.items[j].content);
      }
    }

    send({
      type: 'progress',
      slideIndex: planIndex,
      stage: 'generating',
      message: `Starting iteration for slide "${item.title}" (${si + 1}/${slideItems.length})...`,
    });

    const slideComment = body.slideComments?.[String(planIndex)] || '';

    // If we have a PDF file, extract per-slide context first
    const contextPromise = body.fileId
      ? (async () => {
          send({
            type: 'progress',
            slideIndex: planIndex,
            stage: 'extracting',
            message: `Extracting paper context for "${item.title}"...`,
          });
          return extractSlideContext(openai, body.fileId!, item.title, item.description);
        })()
      : Promise.resolve('');

    return contextPromise.then(paperContext => {
      const fullContext = paperContext
        ? `${contextParts.join(' ')}\n\n--- Relevant content from the paper ---\n${paperContext}`
        : contextParts.join(' ');

      const spec: SlideSpec = {
        topic: body.topic,
        title: item.title,
        description: item.description + (slideComment ? `\n\nUser comment: ${slideComment}` : ''),
        context: fullContext,
      };

      return generateAndIterateSlide(openai, spec, (stage, message) => {
        send({ type: 'progress', slideIndex: planIndex, stage, message });
      }).then(result => {
        send({
          type: 'item',
          index: planIndex,
          item: { type: 'slide', title: item.title, manimCode: result.manimCode },
        });
      });
    });
  });

  // Let all slides settle before closing the stream; another slide may still
  // be sending a result when one of its peers reaches the quota.
  return Promise.allSettled(slidePromises).then(results => {
    const failure = results.find(result => result.status === 'rejected');
    if (failure?.status === 'rejected') throw failure.reason;
  });
}

async function handleGenerate(
  openai: OpenAI,
  body: {
    topic: string;
    items: Array<{ type: string; content: string; title: string; description: string }>;
    userComments: string;
    slideComments?: Record<string, string>;
    fileId?: string;
  },
) {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      function send(event: Record<string, unknown>) {
        controller.enqueue(encoder.encode(JSON.stringify(event) + '\n'));
      }

      try {
        const textResponse = await generateTextItems(openai, body, send);

        const textData = JSON.parse(textResponse.choices[0].message.content!);
        const textMap = new Map<number, string>();
        for (const t of textData.texts) {
          textMap.set(t.planIndex, t.content);
        }

        for (let i = 0; i < body.items.length; i++) {
          if (body.items[i].type === 'text') {
            const content = textMap.get(i) || body.items[i].content;
            send({ type: 'item', index: i, item: { type: 'text', content } });
          }
        }

        await generateSlidesInParallel(openai, body, textMap, send);

        send({ type: 'done' });
      } catch (err) {
        const error = publicError(err, 'Failed to generate animations');
        send({ type: 'error', message: error.error, status: error.status });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}

type TextPart = { type: 'text'; text: string };
type ImagePart = { type: 'image_url'; image_url: { url: string } };
type MessageContent = string | (TextPart | ImagePart)[];
type ApiMessage = { role: 'system' | 'user'; content: MessageContent };

async function handleRegenerateSlide(openai: OpenAI, body: { topic: string; slideTitle: string; slideDescription: string; userComment: string; sessionContext: string; failedCode?: string; error?: string; currentCode?: string; currentFrame?: string; fileId?: string }) {
  // If we have a paper file, extract targeted context for this slide
  let paperContext = '';
  if (body.fileId) {
    try {
      paperContext = await extractSlideContext(openai, body.fileId, body.slideTitle, body.slideDescription);
    } catch (e) {
      if (publicError(e, '').status === 429) throw e;
    }
  }

  let userPrompt = `Topic: ${body.topic}
Slide: "${body.slideTitle}" — ${body.slideDescription}
Context in the document: ${body.sessionContext}${paperContext ? `\n\n--- Relevant content from the paper ---\n${paperContext}` : ''}`;

  if (body.currentCode) {
    userPrompt += `\n\nCurrent code for this slide:\n\`\`\`javascript\n${body.currentCode}\n\`\`\``;
  }

  if (body.failedCode && body.error) {
    userPrompt += `\n\nThe code you generated failed to run in the browser. Please fix it.\n\nError:\n${body.error}\n\nFailed code:\n\`\`\`javascript\n${body.failedCode}\n\`\`\``;
  } else if (body.userComment) {
    userPrompt += `\n\nUser feedback: ${body.userComment}`;
  }

  const messages: ApiMessage[] = [
    { role: 'system', content: REGENERATE_SYSTEM_PROMPT },
  ];

  if (body.currentFrame) {
    messages.push({
      role: 'user',
      content: [
        { type: 'text', text: userPrompt },
        { type: 'image_url', image_url: { url: body.currentFrame } },
      ],
    });
  } else {
    messages.push({ role: 'user', content: userPrompt });
  }

  const response = await openai.chat.completions.create({
    model: 'gpt-5.4',
    messages: messages as import('openai/resources/chat/completions').ChatCompletionMessageParam[],
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: 'slide_regeneration',
        strict: true,
        schema: {
          type: 'object',
          properties: {
            manimCode: {
              type: 'string',
              description: 'The manim-web JS code for this slide',
            },
          },
          required: ['manimCode'],
          additionalProperties: false,
        },
      },
    },
  });

  const content = JSON.parse(response.choices[0].message.content!);
  return NextResponse.json(content);
}

const REGENERATE_COURSE_SYSTEM_PROMPT = `You are a mathematics visualization assistant. You are regenerating an entire interactive explainer lesson based on user feedback.

You will receive:
- The original topic
- The original plan (items list)
- The full lesson context (text content and slide code from the previous version)
- Per-slide user comments
- Overall user feedback

Generate revised text for each text item, incorporating the feedback. Keep the same plan structure. Revise wording for flow and incorporate the user's overall feedback. Keep text items to 1-2 short sentences each.`;

async function handleRegenerateCourse(
  openai: OpenAI,
  body: {
    topic: string;
    items: Array<{ type: string; content: string; title: string; description: string }>;
    lessonContext: Array<{ type: string; content?: string; title?: string; description?: string; manimCode?: string; comment?: string }>;
    overallFeedback: string;
    fileId?: string;
  },
) {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      function send(event: Record<string, unknown>) {
        controller.enqueue(encoder.encode(JSON.stringify(event) + '\n'));
      }

      try {
        const lessonSummary = body.lessonContext.map((item, i) => {
          if (item.type === 'text') return `[Text ${i}]: ${item.content}`;
          return `[Slide ${i}]: "${item.title}" — ${item.description}${item.comment ? `\n  User comment: ${item.comment}` : ''}`;
        }).join('\n');

        send({ type: 'progress', stage: 'generating', message: 'Regenerating text sections...' });

        const textResponse = await openai.chat.completions.create({
          model: 'gpt-5.4',
          messages: [
            { role: 'system', content: REGENERATE_COURSE_SYSTEM_PROMPT },
            {
              role: 'user',
              content: `Topic: ${body.topic}\n\nPrevious lesson:\n${lessonSummary}\n\nOverall feedback: ${body.overallFeedback}\n\nGenerate revised text for each text item. Return them in the same order as the plan.`,
            },
          ],
          response_format: {
            type: 'json_schema',
            json_schema: {
              name: 'text_items',
              strict: true,
              schema: {
                type: 'object',
                properties: {
                  texts: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        planIndex: { type: 'number', description: 'The index of this item in the original plan' },
                        content: { type: 'string', description: 'The revised text content' },
                      },
                      required: ['planIndex', 'content'],
                      additionalProperties: false,
                    },
                  },
                },
                required: ['texts'],
                additionalProperties: false,
              },
            },
          },
        });

        const textData = JSON.parse(textResponse.choices[0].message.content!);
        const textMap = new Map<number, string>();
        for (const t of textData.texts) {
          textMap.set(t.planIndex, t.content);
        }

        for (let i = 0; i < body.items.length; i++) {
          if (body.items[i].type === 'text') {
            const content = textMap.get(i) || body.items[i].content;
            send({ type: 'item', index: i, item: { type: 'text', content } });
          }
        }

        const slideComments: Record<string, string> = {};
        for (const item of body.lessonContext) {
          if (item.type === 'slide' && item.comment) {
            const idx = body.lessonContext.indexOf(item);
            slideComments[String(idx)] = item.comment;
          }
        }

        await generateSlidesInParallel(
          openai,
          { topic: body.topic, items: body.items, slideComments, fileId: body.fileId },
          textMap,
          send,
        );

        send({ type: 'done' });
      } catch (err) {
        const error = publicError(err, 'Failed to regenerate animations');
        send({ type: 'error', message: error.error, status: error.status });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}
