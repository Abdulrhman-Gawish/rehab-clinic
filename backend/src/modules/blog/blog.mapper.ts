import { UserRefDto } from '../../common/dto/user-ref.dto.js';
import type {
  BlogPostResponseDto,
  BlogPostSummaryDto,
  PublicBlogPostDto,
  PublicBlogPostSummaryDto,
} from './dto/blog.dto.js';
import type { BlogPost } from './entities/blog-post.entity.js';

type ToIso = (instant: Date) => string;

export function toPublicBlogPostSummary(
  post: BlogPost,
  toIso: ToIso,
): PublicBlogPostSummaryDto {
  return {
    id: post.id,
    title: post.title,
    description: post.description,
    category: post.category,
    createdAt: toIso(post.createdAt),
    updatedAt: toIso(post.updatedAt),
  };
}

export function toPublicBlogPost(
  post: BlogPost,
  toIso: ToIso,
): PublicBlogPostDto {
  return {
    ...toPublicBlogPostSummary(post, toIso),
    keywords: post.keywords,
    content: post.content,
  };
}

// Requires `author` loaded.
export function toBlogPostSummary(
  post: BlogPost,
  toIso: ToIso,
): BlogPostSummaryDto {
  return {
    ...toPublicBlogPostSummary(post, toIso),
    keywords: post.keywords,
    author: UserRefDto.fromEntity(post.author),
  };
}

// Requires `author` loaded.
export function toBlogPost(post: BlogPost, toIso: ToIso): BlogPostResponseDto {
  return { ...toBlogPostSummary(post, toIso), content: post.content };
}
