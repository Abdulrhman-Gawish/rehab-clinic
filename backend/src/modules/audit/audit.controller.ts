import { Controller, Get, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Auth } from '../../common/decorators/api-auth.decorator.js';
import {
  PaginatedResponse,
  type Paginated,
} from '../../common/dto/pagination.dto.js';
import { UserRole } from '../../common/enums/user-role.enum.js';
import { AuditService } from './audit.service.js';
import { AuditLogResponseDto, ListAuditLogsQueryDto } from './dto/audit.dto.js';

@ApiTags('Audit logs')
@Controller('audit-logs')
@Auth(UserRole.OWNER)
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Get()
  @ApiOperation({ summary: 'Search the audit trail (newest first)' })
  @ApiOkResponse({ type: PaginatedResponse(AuditLogResponseDto) })
  findAll(
    @Query() query: ListAuditLogsQueryDto,
  ): Promise<Paginated<AuditLogResponseDto>> {
    return this.auditService.findAll(query);
  }
}
