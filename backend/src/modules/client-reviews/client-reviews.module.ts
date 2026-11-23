import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FileStorage } from '../../common/storage/file-storage.service.js';
import { ClientReviewsController } from './client-reviews.controller.js';
import { ClientReviewsService } from './client-reviews.service.js';
import { ClientReviewAttachment } from './entities/client-review-attachment.entity.js';
import { ClientReview } from './entities/client-review.entity.js';

// Client reviews (testimonials) and their attachments: OWNER only.
@Module({
  imports: [TypeOrmModule.forFeature([ClientReview, ClientReviewAttachment])],
  controllers: [ClientReviewsController],
  providers: [ClientReviewsService, FileStorage],
})
export class ClientReviewsModule {}
