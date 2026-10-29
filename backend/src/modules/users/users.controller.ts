import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Auth } from '../../common/decorators/api-auth.decorator.js';
import { CurrentActor } from '../../common/decorators/current-user.decorator.js';
import { ErrorResponseDto } from '../../common/dto/error-response.dto.js';
import {
  PaginatedResponse,
  type Paginated,
} from '../../common/dto/pagination.dto.js';
import { UserRole } from '../../common/enums/user-role.enum.js';
import type { Actor } from '../../common/interfaces/authenticated-request.interface.js';
import { CreateUserDto } from './dto/create-user.dto.js';
import { ListUsersQueryDto } from './dto/list-users-query.dto.js';
import { ResetPasswordDto } from './dto/reset-password.dto.js';
import { UpdateUserDto } from './dto/update-user.dto.js';
import { UserResponseDto } from './dto/user-response.dto.js';
import { UsersService } from './users.service.js';

@ApiTags('Users')
@Controller('users')
@Auth(UserRole.OWNER)
@ApiBadRequestResponse({ type: ErrorResponseDto })
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Post()
  @ApiOperation({ summary: 'Create an OWNER or RECEPTIONIST account' })
  @ApiCreatedResponse({ type: UserResponseDto })
  @ApiConflictResponse({ type: ErrorResponseDto, description: 'Email taken' })
  create(
    @Body() dto: CreateUserDto,
    @CurrentActor() actor: Actor,
  ): Promise<UserResponseDto> {
    return this.usersService.create(dto, actor);
  }

  @Get()
  @ApiOperation({ summary: 'List users (filter by role, status, name/email)' })
  @ApiOkResponse({ type: PaginatedResponse(UserResponseDto) })
  findAll(
    @Query() query: ListUsersQueryDto,
  ): Promise<Paginated<UserResponseDto>> {
    return this.usersService.findAll(query);
  }

  @Get(':id')
  @ApiOkResponse({ type: UserResponseDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  findOne(@Param('id', ParseUUIDPipe) id: string): Promise<UserResponseDto> {
    return this.usersService.findOne(id);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Update name, email, phone or role (not for doctor accounts)',
  })
  @ApiOkResponse({ type: UserResponseDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  @ApiConflictResponse({
    type: ErrorResponseDto,
    description: 'Email taken, doctor account, or last active OWNER',
  })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserDto,
    @CurrentActor() actor: Actor,
  ): Promise<UserResponseDto> {
    return this.usersService.update(id, dto, actor);
  }

  @Patch(':id/activate')
  @ApiOkResponse({ type: UserResponseDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  activate(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentActor() actor: Actor,
  ): Promise<UserResponseDto> {
    return this.usersService.setActive(id, true, actor);
  }

  @Patch(':id/deactivate')
  @ApiOperation({
    summary: 'Deactivate and sign out everywhere',
    description:
      'You cannot deactivate yourself, and at least one active OWNER must remain.',
  })
  @ApiOkResponse({ type: UserResponseDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  @ApiConflictResponse({ type: ErrorResponseDto })
  deactivate(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentActor() actor: Actor,
  ): Promise<UserResponseDto> {
    return this.usersService.setActive(id, false, actor);
  }

  @Post(':id/reset-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Set a new password and sign the user out everywhere',
  })
  @ApiNoContentResponse()
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  resetPassword(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ResetPasswordDto,
    @CurrentActor() actor: Actor,
  ): Promise<void> {
    return this.usersService.resetPassword(id, dto, actor);
  }
}
