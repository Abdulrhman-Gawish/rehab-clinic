import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FileStorage } from '../../common/storage/file-storage.service.js';
import {
  BlogPostsController,
  PublicBlogPostsController,
} from './blog.controller.js';
import { BlogService } from './blog.service.js';
import { BlogPost } from './entities/blog-post.entity.js';

// Blog posts: written by the OWNER, read by the public website.
@Module({
  imports: [TypeOrmModule.forFeature([BlogPost])],
  controllers: [BlogPostsController, PublicBlogPostsController],
  providers: [BlogService, FileStorage],
})
export class BlogModule {}
