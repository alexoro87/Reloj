import { describe, expect, it } from "vitest";
import { actionFromText, parseWebhook, renderBody } from "./whatsapp";

describe("parseWebhook", () => {
  it("lee respuestas de botón de plantilla con token", () => {
    const msgs = parseWebhook({
      entry: [
        {
          changes: [
            {
              value: {
                metadata: { phone_number_id: "123" },
                messages: [
                  {
                    from: "525511112222",
                    type: "button",
                    button: { text: "Confirmar", payload: "CONFIRM:abc_123" },
                  },
                ],
              },
            },
          ],
        },
      ],
    });
    expect(msgs).toEqual([
      {
        from: "525511112222",
        phoneNumberId: "123",
        text: "Confirmar",
        action: "CONFIRM",
        token: "abc_123",
      },
    ]);
  });

  it("interpreta texto libre", () => {
    const msgs = parseWebhook({
      entry: [
        {
          changes: [
            {
              value: {
                messages: [{ from: "52", type: "text", text: { body: "No podré ir, cancelo" } }],
              },
            },
          ],
        },
      ],
    });
    expect(msgs[0].action).toBe("CANCEL");
    expect(msgs[0].token).toBeNull();
  });

  it("ignora eventos de estado sin mensajes", () => {
    expect(parseWebhook({ entry: [{ changes: [{ value: { statuses: [{}] } }] }] })).toEqual([]);
    expect(parseWebhook(null)).toEqual([]);
  });
});

describe("actionFromText", () => {
  it.each([
    ["Sí", "CONFIRM"],
    ["si, ahí estaré", "CONFIRM"],
    ["Confirmo", "CONFIRM"],
    ["cancelar", "CANCEL"],
    ["no", "CANCEL"],
    ["nos vemos", null],
    ["¿a qué hora era?", null],
  ])("%s → %s", (text, expected) => {
    expect(actionFromText(text)).toBe(expected);
  });
});

it("renderiza el cuerpo de la plantilla", () => {
  expect(renderBody("follow_up", ["Ana", "Pie Sano", "Quiropodia", "Dra. Laura"])).toBe(
    "Hola Ana, en Pie Sano ya toca tu revisión de Quiropodia con Dra. Laura. " +
      "Agenda en un clic para mantener tus pies sanos.",
  );
});
