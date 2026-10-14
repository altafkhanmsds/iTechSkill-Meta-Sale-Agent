/**
 * Deterministic Routing Precedence Engine
 *
 * Enforces strict routing priority:
 * 1. Direct human request / handoff (Multilingual: English, Roman Urdu, Urdu) -> 'conversation' + handoff_requested: true
 * 2. Stop / opt-out request -> 'conversation' + question_focus: 'opt_out'
 * 3. Payment evidence detection -> 'conversation' + question_focus: 'support'
 * 4. Catalog / Course intent (only evaluated if not a human request)
 */

export interface RoutingInput {
  message: string;
  has_prior_contact?: boolean;
  media_category?: string;
  payment_evidence_detected?: boolean;
  selected_source_key?: string;
  selected_program_name?: string;
  selected_program_type?: string;
  last_presented_options?: Array<{ title?: string; number?: number; source_key?: string; program_type?: string }>;
}

export interface RoutingOutput {
  language: "English" | "Roman Urdu" | "Urdu";
  route_type: "conversation" | "greeting" | "category_catalog" | "specific_course" | "broad_course" | "primary_menu";
  course_name?: string;
  program_type?: string;
  question_focus?: string;
  handoff_requested: boolean;
  opted_out_requested: boolean;
}

// Regex patterns for explicit human counselor / staff requests across languages
const HUMAN_REQUEST_ENGLISH = /\b(human|person|counselor|counsellor|agent|representative|advisor|staff|team member|admissions officer|talk to someone|connect me|speak with someone)\b/i;
const HUMAN_REQUEST_ROMAN_URDU = /\b(baat karni|baat krni|kisi se baat|agent se|insan se|banday se|counselor se|rabta karwa|connect karwa|call karwa|admissions counselor)\b/i;
const HUMAN_REQUEST_URDU = /(نمائندے|کونسلر|بات کرنی|بات کروائیں|رابطہ کروائیں|عملے|کسی سے بات)/;

// Opt-out patterns
const OPT_OUT_PATTERNS = /\b(stop|unsubscribe|remove my number|remove me|opt out|mat bhejo|band karo|روک دیں|میسج نہ کریں)\b/i;

export function detectLanguage(text: string): "English" | "Roman Urdu" | "Urdu" {
  // Check for Arabic/Urdu unicode range
  if (/[\u0600-\u06FF]/.test(text)) {
    return "Urdu";
  }

  // Common Roman Urdu stopwords
  const romanUrduIndicators = /\b(mujhe|karni|bhej|dein|karein|hai|hain|ki|ka|ke|ko|se|aur|batao|karo|konsa|kitni|kab)\b/i;
  if (romanUrduIndicators.test(text)) {
    return "Roman Urdu";
  }

  return "English";
}

export function classifyRoute(input: RoutingInput): RoutingOutput {
  const text = (input.message || "").trim();
  const lang = detectLanguage(text);

  // 1. Opt-out Precedence
  if (OPT_OUT_PATTERNS.test(text)) {
    return {
      language: lang,
      route_type: "conversation",
      course_name: "",
      program_type: "",
      question_focus: "opt_out",
      handoff_requested: false,
      opted_out_requested: true,
    };
  }

  // 2. Payment Evidence Precedence
  if (input.payment_evidence_detected || input.media_category === "payment_receipt") {
    return {
      language: lang,
      route_type: "conversation",
      course_name: "",
      program_type: "",
      question_focus: "support",
      handoff_requested: true,
      opted_out_requested: false,
    };
  }

  // 3. PRIORITY 0: Direct Human Request Precedence
  // Must execute BEFORE course keywords like "admissions" or "counselor" match course catalogs
  const isHumanRequest =
    HUMAN_REQUEST_ENGLISH.test(text) ||
    HUMAN_REQUEST_ROMAN_URDU.test(text) ||
    HUMAN_REQUEST_URDU.test(text);

  if (isHumanRequest) {
    return {
      language: lang,
      route_type: "conversation",
      course_name: "",
      program_type: "",
      question_focus: "human_handoff",
      handoff_requested: true,
      opted_out_requested: false,
    };
  }

  // 4. Greeting
  if (/^(hi|hello|salam|assalam|aaoa|hey)$/i.test(text) && !input.has_prior_contact) {
    return {
      language: lang,
      route_type: "greeting",
      course_name: "",
      program_type: "",
      question_focus: "greeting",
      handoff_requested: false,
      opted_out_requested: false,
    };
  }

  // 5. Options Selection (Menu numbers like "1", "2")
  if (/^\d+$/.test(text) && input.last_presented_options && input.last_presented_options.length > 0) {
    const num = parseInt(text, 10);
    const selected = input.last_presented_options.find((opt) => opt.number === num);
    if (selected) {
      if (selected.source_key) {
        return {
          language: lang,
          route_type: "specific_course",
          course_name: selected.title || "",
          program_type: selected.program_type || "",
          handoff_requested: false,
          opted_out_requested: false,
        };
      }
      return {
        language: lang,
        route_type: "category_catalog",
        program_type: selected.program_type || "",
        question_focus: "menu",
        handoff_requested: false,
        opted_out_requested: false,
      };
    }
  }

  // 6. Fee follow-up on existing course
  if (input.selected_program_name && /\b(fee|fees|duration|kitni fee|cost|charges)\b/i.test(text)) {
    return {
      language: lang,
      route_type: "specific_course",
      course_name: input.selected_program_name,
      program_type: input.selected_program_type || "short_course",
      question_focus: "payment",
      handoff_requested: false,
      opted_out_requested: false,
    };
  }

  // 7. Course Category Menus
  if (/\b(diploma|diplomas)\b/i.test(text)) {
    return {
      language: lang,
      route_type: "category_catalog",
      program_type: "diploma",
      question_focus: "menu",
      handoff_requested: false,
      opted_out_requested: false,
    };
  }

  if (/\b(short course|short courses|شارٹ کورسز)\b/i.test(text)) {
    return {
      language: lang,
      route_type: "category_catalog",
      program_type: "short_course",
      question_focus: "menu",
      handoff_requested: false,
      opted_out_requested: false,
    };
  }

  if (/\b(long course|long courses)\b/i.test(text)) {
    return {
      language: lang,
      route_type: "category_catalog",
      program_type: "long_course",
      question_focus: "menu",
      handoff_requested: false,
      opted_out_requested: false,
    };
  }

  // Default broad offering
  return {
    language: lang,
    route_type: "primary_menu",
    program_type: "",
    question_focus: "menu",
    handoff_requested: false,
    opted_out_requested: false,
  };
}

export function evaluateRoutingPrecedence(query: string) {
  const classified = classifyRoute({ message: query });
  let intent = "course_catalog";
  if (classified.handoff_requested) intent = "human_advisor";
  else if (classified.opted_out_requested) intent = "opt_out";
  else if (classified.route_type === "conversation") intent = "conversation";

  let lang = "en";
  if (classified.language === "Roman Urdu") lang = "roman_urdu";
  else if (classified.language === "Urdu") lang = "ur";

  return {
    intent,
    requiresHandoff: classified.handoff_requested,
    detectedLanguage: lang,
    raw: classified,
  };
}
