import { Injectable } from '@nestjs/common';
import { createClient } from '@supabase/supabase-js';
import { CreateLectureDto, UpdateLectureDto } from './lectures.controller';

@Injectable()
export class LecturesService {
  private supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_ANON_KEY!,
  );

  async getLecturesBySection(sectionId: string) {
    const { data, error } = await this.supabase
      .from('lectures')
      .select('*')
      .eq('section_id', sectionId)
      .order('order_index', { ascending: true });

    if (error) {
      throw new Error(`Failed to fetch lectures: ${error.message}`);
    }

    return { success: true, data };
  }

  async createLecture(
    sectionId: string,
    lectureData: CreateLectureDto,
    token: string,
  ) {
    // Set authorization header for RLS
    this.supabase.auth.setSession({
      access_token: token,
      refresh_token: '',
    } as any);

    const { data, error } = await this.supabase
      .from('lectures')
      .insert({
        section_id: sectionId,
        title: lectureData.title,
        content: lectureData.content,
        video_url: lectureData.video_url,
        duration_minutes: lectureData.duration_minutes,
        order_index: lectureData.order_index || 0,
        status: lectureData.status || 'draft',
        attachments: lectureData.attachments || [],
        learning_objectives: lectureData.learning_objectives || [],
        prerequisites: lectureData.prerequisites || [],
        tags: lectureData.tags || [],
      })
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to create lecture: ${error.message}`);
    }

    return { success: true, data };
  }

  async getLecture(lectureId: string) {
    const { data, error } = await this.supabase
      .from('lectures')
      .select('*')
      .eq('id', lectureId)
      .single();

    if (error) {
      throw new Error(`Failed to fetch lecture: ${error.message}`);
    }

    return { success: true, data };
  }

  async updateLecture(
    lectureId: string,
    updateData: UpdateLectureDto,
    token: string,
  ) {
    // Set authorization header for RLS
    this.supabase.auth.setSession({
      access_token: token,
      refresh_token: '',
    } as any);

    const { data, error } = await this.supabase
      .from('lectures')
      .update({
        ...updateData,
        updated_at: new Date().toISOString(),
      })
      .eq('id', lectureId)
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to update lecture: ${error.message}`);
    }

    return { success: true, data };
  }

  async deleteLecture(lectureId: string, token: string) {
    // Set authorization header for RLS
    this.supabase.auth.setSession({
      access_token: token,
      refresh_token: '',
    } as any);

    const { error } = await this.supabase
      .from('lectures')
      .delete()
      .eq('id', lectureId);

    if (error) {
      throw new Error(`Failed to delete lecture: ${error.message}`);
    }

    return { success: true, message: 'Lecture deleted successfully' };
  }

  async addAttachment(lectureId: string, attachment: any, token: string) {
    // Set authorization header for RLS
    this.supabase.auth.setSession({
      access_token: token,
      refresh_token: '',
    } as any);

    // First get current attachments
    const { data: lecture, error: fetchError } = await this.supabase
      .from('lectures')
      .select('attachments')
      .eq('id', lectureId)
      .single();

    if (fetchError) {
      throw new Error(`Failed to fetch lecture: ${fetchError.message}`);
    }

    const currentAttachments = lecture.attachments || [];
    const updatedAttachments = [...currentAttachments, attachment];

    const { data, error } = await this.supabase
      .from('lectures')
      .update({
        attachments: updatedAttachments,
        updated_at: new Date().toISOString(),
      })
      .eq('id', lectureId)
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to add attachment: ${error.message}`);
    }

    return { success: true, data };
  }

  async reorderLectures(
    sectionId: string,
    lectureIds: string[],
    token: string,
  ) {
    // Set authorization header for RLS
    this.supabase.auth.setSession({
      access_token: token,
      refresh_token: '',
    } as any);

    const updates = lectureIds.map((lectureId, index) => ({
      id: lectureId,
      order_index: index,
      updated_at: new Date().toISOString(),
    }));

    const { data, error } = await this.supabase
      .from('lectures')
      .upsert(updates)
      .select();

    if (error) {
      throw new Error(`Failed to reorder lectures: ${error.message}`);
    }

    return { success: true, data };
  }
}
