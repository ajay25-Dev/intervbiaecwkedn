import { Injectable, InternalServerErrorException } from '@nestjs/common';

@Injectable()
export class QuizService {
  private restUrl = `${process.env.SUPABASE_URL}/rest/v1`;
  private serviceKey = process.env.SUPABASE_SERVICE_ROLE?.trim();

  private headers() {
    const sk = this.serviceKey;
    const looksJwt = sk && sk.split('.').length === 3 && sk.length > 60;
    if (looksJwt) {
      return {
        apikey: sk,
        Authorization: `Bearer ${sk}`,
        'Content-Type': 'application/json',
      };
    }
    throw new InternalServerErrorException(
      'Supabase service key missing for quizzes',
    );
  }

  async createQuiz(title: string, section_id: string) {
    const url = `${this.restUrl}/quizzes`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { ...this.headers(), Prefer: 'return=representation' },
      body: JSON.stringify([{ title, section_id }]),
    });
    if (!res.ok)
      throw new InternalServerErrorException(
        `Quiz insert failed: ${res.status} ${await res.text()}`,
      );
    const [row] = await res.json();
    return row;
  }

  async updateQuiz(id: string, title: string, section_id: string) {
    const url = `${this.restUrl}/quizzes?id=eq.${id}`;
    const res = await fetch(url, {
      method: 'PATCH',
      headers: { ...this.headers(), Prefer: 'return=representation' },
      body: JSON.stringify({ title, section_id }),
    });
    if (!res.ok)
      throw new InternalServerErrorException(
        `Quiz update failed: ${res.status} ${await res.text()}`,
      );
    const [row] = await res.json();
    return row;
  }

  async deleteQuiz(id: string) {
    const url = `${this.restUrl}/quizzes?id=eq.${id}`;
    const res = await fetch(url, {
      method: 'DELETE',
      headers: this.headers(),
    });
    if (!res.ok)
      throw new InternalServerErrorException(
        `Quiz delete failed: ${res.status} ${await res.text()}`,
      );
    return { success: true };
  }

  async getQuiz(id: string) {
    const url = `${this.restUrl}/quizzes?id=eq.${id}&select=*,quiz_questions(*,quiz_options(*))`;
    const res = await fetch(url, { headers: this.headers() });
    if (!res.ok)
      throw new InternalServerErrorException(
        `Quiz fetch failed: ${res.status} ${await res.text()}`,
      );
    const [row] = await res.json();
    return row;
  }

  async getQuizzesBySection(sectionId: string) {
    const url = `${this.restUrl}/quizzes?section_id=eq.${sectionId}&select=*,quiz_questions(*)`;
    const res = await fetch(url, { headers: this.headers() });
    if (!res.ok)
      throw new InternalServerErrorException(
        `Quizzes by section fetch failed: ${res.status} ${await res.text()}`,
      );
    return res.json();
  }

  async createQuestion(
    quizId: string,
    type: string,
    text: string,
    order_index: number,
    content: string,
  ) {
    const url = `${this.restUrl}/quiz_questions`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { ...this.headers(), Prefer: 'return=representation' },
      body: JSON.stringify([
        { quiz_id: quizId, type, text, order_index, content },
      ]),
    });
    if (!res.ok)
      throw new InternalServerErrorException(
        `Question insert failed: ${res.status} ${await res.text()}`,
      );
    const [row] = await res.json();
    return row;
  }

  async updateQuestion(
    id: string,
    type: string,
    text: string,
    order_index: number,
    content: string,
  ) {
    const url = `${this.restUrl}/quiz_questions?id=eq.${id}`;
    const res = await fetch(url, {
      method: 'PATCH',
      headers: { ...this.headers(), Prefer: 'return=representation' },
      body: JSON.stringify({ type, text, order_index, content }),
    });
    if (!res.ok)
      throw new InternalServerErrorException(
        `Question update failed: ${res.status} ${await res.text()}`,
      );
    const [row] = await res.json();
    return row;
  }

  async deleteQuestion(id: string) {
    const url = `${this.restUrl}/quiz_questions?id=eq.${id}`;
    const res = await fetch(url, {
      method: 'DELETE',
      headers: this.headers(),
    });
    if (!res.ok)
      throw new InternalServerErrorException(
        `Question delete failed: ${res.status} ${await res.text()}`,
      );
    return { success: true };
  }

  async getQuestionsByQuiz(quizId: string) {
    const url = `${this.restUrl}/quiz_questions?quiz_id=eq.${quizId}&select=*,quiz_options(*)`;
    const res = await fetch(url, { headers: this.headers() });
    if (!res.ok)
      throw new InternalServerErrorException(
        `Questions by quiz fetch failed: ${res.status} ${await res.text()}`,
      );
    return res.json();
  }

  async createOption(questionId: string, text: string, correct: boolean) {
    const url = `${this.restUrl}/quiz_options`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { ...this.headers(), Prefer: 'return=representation' },
      body: JSON.stringify([{ question_id: questionId, text, correct }]),
    });
    if (!res.ok)
      throw new InternalServerErrorException(
        `Option insert failed: ${res.status} ${await res.text()}`,
      );
    const [row] = await res.json();
    return row;
  }

  async updateOption(id: string, text: string, correct: boolean) {
    const url = `${this.restUrl}/quiz_options?id=eq.${id}`;
    const res = await fetch(url, {
      method: 'PATCH',
      headers: { ...this.headers(), Prefer: 'return=representation' },
      body: JSON.stringify({ text, correct }),
    });
    if (!res.ok)
      throw new InternalServerErrorException(
        `Option update failed: ${res.status} ${await res.text()}`,
      );
    const [row] = await res.json();
    return row;
  }

  async deleteOption(id: string) {
    const url = `${this.restUrl}/quiz_options?id=eq.${id}`;
    const res = await fetch(url, {
      method: 'DELETE',
      headers: this.headers(),
    });
    if (!res.ok)
      throw new InternalServerErrorException(
        `Option delete failed: ${res.status} ${await res.text()}`,
      );
    return { success: true };
  }

  async getOptionsByQuestion(questionId: string) {
    const url = `${this.restUrl}/quiz_options?question_id=eq.${questionId}`;
    const res = await fetch(url, { headers: this.headers() });
    if (!res.ok)
      throw new InternalServerErrorException(
        `Options by question fetch failed: ${res.status} ${await res.text()}`,
      );
    return res.json();
  }

  async submitQuiz(
    quizId: string,
    userId: string,
    responses: Array<{
      questionId: string;
      selectedOptionId: string | null;
      isCorrect: boolean;
    }>,
    score: number,
    timeTaken: number,
  ) {
    // Create quiz attempt record
    const attemptUrl = `${this.restUrl}/quiz_attempts`;
    const attemptRes = await fetch(attemptUrl, {
      method: 'POST',
      headers: { ...this.headers(), Prefer: 'return=representation' },
      body: JSON.stringify([
        {
          quiz_id: quizId,
          user_id: userId,
          score: score,
          completed_at: new Date().toISOString(),
          time_taken_seconds: timeTaken,
        },
      ]),
    });

    if (!attemptRes.ok) {
      throw new InternalServerErrorException(
        `Quiz attempt insert failed: ${attemptRes.status} ${await attemptRes.text()}`,
      );
    }

    const [attempt] = await attemptRes.json();

    // Store individual responses
    const responsesData = responses.map((r) => ({
      attempt_id: attempt.id,
      question_id: r.questionId,
      selected_option_id: r.selectedOptionId,
      is_correct: r.isCorrect,
      user_id: userId,
    }));

    if (responsesData.length > 0) {
      const responsesUrl = `${this.restUrl}/quiz_responses`;
      const responsesRes = await fetch(responsesUrl, {
        method: 'POST',
        headers: { ...this.headers(), Prefer: 'return=representation' },
        body: JSON.stringify(responsesData),
      });

      if (!responsesRes.ok) {
        throw new InternalServerErrorException(
          `Quiz responses insert failed: ${responsesRes.status} ${await responsesRes.text()}`,
        );
      }
    }

    return {
      attemptId: attempt.id,
      score,
      timeTaken,
      success: true,
    };
  }

  async getQuizAnswers(questionIds: string[]) {
    if (!Array.isArray(questionIds) || questionIds.length === 0) {
      return [];
    }
    const uniqueIds = Array.from(
      new Set(
        questionIds
          .filter(
            (value) => typeof value === 'string' && value.trim().length > 0,
          )
          .map((value) => value.trim()),
      ),
    );
    if (!uniqueIds.length) {
      return [];
    }
    const inClause = uniqueIds.join(',');
    const url = `${this.restUrl}/quiz_options?question_id=in.(${inClause})`;
    const res = await fetch(url, { headers: this.headers() });
    if (!res.ok) {
      throw new InternalServerErrorException(
        `Quiz answers fetch failed: ${res.status} ${await res.text()}`,
      );
    }
    const payload = (await res.json()) ?? [];
    const answersById = new Map<string, any>();
    if (Array.isArray(payload)) {
      payload.forEach((record) => {
        const rawId =
          record?.question_id ??
          record?.questionId ??
          record?.quiz_question_id ??
          record?.quiz_questionId;
        if (!rawId) {
          return;
        }
        const questionId = String(rawId);
        if (!answersById.has(questionId)) {
          answersById.set(questionId, record);
        }
      });
    }

    const missing = uniqueIds.filter((id) => !answersById.has(id));
    if (missing.length) {
      const fallbackClause = missing.join(',');
      const fallbackUrl = `${this.restUrl}/quiz_options?question_id=in.(${fallbackClause})&correct=eq.true`;
      const fallbackRes = await fetch(fallbackUrl, { headers: this.headers() });
      if (!fallbackRes.ok) {
        throw new InternalServerErrorException(
          `Quiz options fetch failed: ${fallbackRes.status} ${await fallbackRes.text()}`,
        );
      }
      const fallbackPayload = (await fallbackRes.json()) ?? [];
      if (Array.isArray(fallbackPayload)) {
        fallbackPayload.forEach((option) => {
          const rawId =
            option?.question_id ??
            option?.questionId ??
            option?.quiz_question_id ??
            option?.quiz_questionId;
          if (!rawId) {
            return;
          }
          const questionId = String(rawId);
          if (answersById.has(questionId)) {
            return;
          }
          const textValue =
            option?.text ??
            option?.answer_text ??
            option?.value ??
            option?.answer ??
            '';
          answersById.set(questionId, {
            question_id: questionId,
            text: typeof textValue === 'string' ? textValue : '',
            answer_text: typeof textValue === 'string' ? textValue : '',
            answer_html:
              typeof textValue === 'string' && textValue.trim().length > 0
                ? textValue
                : null,
            option_id: option?.id ?? option?.option_id ?? null,
            source: 'quiz_options',
          });
        });
      }
    }

    return Array.from(answersById.values());
  }
}
