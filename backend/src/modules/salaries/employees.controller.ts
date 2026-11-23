import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnprocessableEntityResponse,
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
import {
  CreateEmployeeDto,
  EmployeeDto,
  EmployeeSalaryOverviewRowDto,
  EmployeeSalaryPaymentDto,
  EmployeeSalaryStatementDto,
  EmployeeSalaryTermsDto,
  ListEmployeesQueryDto,
  SetEmployeeSalaryDto,
  UpdateEmployeeDto,
} from './dto/employees.dto.js';
import {
  RecordSalaryPaymentDto,
  SalaryMonthQueryDto,
  SalaryReasonDto,
} from './dto/salaries.dto.js';
import { EmployeeSalariesService } from './employee-salaries.service.js';
import { EmployeesService } from './employees.service.js';

const { OWNER } = UserRole;
const USER_LINK =
  'userId (optional): an OWNER or RECEPTIONIST account not linked to another employee (422 EMPLOYEE_USER_INVALID, 409 EMPLOYEE_USER_TAKEN).';

// The clinic's employees (not doctors), paid a fixed monthly salary: OWNER only.
@ApiTags('Employees')
@Controller('employees')
@Auth(OWNER)
@ApiBadRequestResponse({ type: ErrorResponseDto })
export class EmployeesController {
  constructor(private readonly employees: EmployeesService) {}

  @Post()
  @ApiOperation({
    summary: 'Add an employee (receptionist, office boy, accountant...)',
    description: `No login needed. ${USER_LINK} An optional first salary version.`,
  })
  @ApiCreatedResponse({ type: EmployeeDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  @ApiConflictResponse({ type: ErrorResponseDto })
  @ApiUnprocessableEntityResponse({ type: ErrorResponseDto })
  create(
    @Body() dto: CreateEmployeeDto,
    @CurrentActor() actor: Actor,
  ): Promise<EmployeeDto> {
    return this.employees.create(dto, actor);
  }

  @Get()
  @ApiOperation({
    summary: 'Employees by name, with the salary in effect this month',
  })
  @ApiOkResponse({ type: PaginatedResponse(EmployeeDto) })
  list(@Query() query: ListEmployeesQueryDto): Promise<Paginated<EmployeeDto>> {
    return this.employees.list(query);
  }

  @Get(':id')
  @ApiOkResponse({ type: EmployeeDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  findOne(@Param('id', ParseUUIDPipe) id: string): Promise<EmployeeDto> {
    return this.employees.findOne(id);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Edit the employee (old and new values audited)',
    description: `${USER_LINK} null unlinks.`,
  })
  @ApiOkResponse({ type: EmployeeDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  @ApiConflictResponse({ type: ErrorResponseDto })
  @ApiUnprocessableEntityResponse({ type: ErrorResponseDto })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateEmployeeDto,
    @CurrentActor() actor: Actor,
  ): Promise<EmployeeDto> {
    return this.employees.update(id, dto, actor);
  }

  @Patch(':id/activate')
  @ApiOperation({ summary: 'Activate the employee' })
  @ApiOkResponse({ type: EmployeeDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  activate(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentActor() actor: Actor,
  ): Promise<EmployeeDto> {
    return this.employees.setActive(id, true, actor);
  }

  @Patch(':id/deactivate')
  @ApiOperation({
    summary: 'Deactivate the employee (e.g. they left)',
    description:
      'A status only: the salary versions still decide what is owed. To stop the salary, set it to 0 from the month after they left.',
  })
  @ApiOkResponse({ type: EmployeeDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  deactivate(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentActor() actor: Actor,
  ): Promise<EmployeeDto> {
    return this.employees.setActive(id, false, actor);
  }
}

// Employees' fixed monthly salaries: OWNER only.
@ApiTags('Employee salaries')
@Controller()
@Auth(OWNER)
@ApiBadRequestResponse({ type: ErrorResponseDto })
export class EmployeeSalariesController {
  constructor(private readonly salaries: EmployeeSalariesService) {}

  @Get('employee-salaries')
  @ApiOperation({ summary: "Every employee's salary totals for a month" })
  @ApiOkResponse({ type: [EmployeeSalaryOverviewRowDto] })
  overview(
    @Query() query: SalaryMonthQueryDto,
  ): Promise<EmployeeSalaryOverviewRowDto[]> {
    return this.salaries.overview(query.month);
  }

  @Get('employees/:employeeId/salary/terms')
  @ApiOperation({
    summary: "An employee's salary versions, newest first",
  })
  @ApiOkResponse({ type: [EmployeeSalaryTermsDto] })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  listTerms(
    @Param('employeeId', ParseUUIDPipe) employeeId: string,
  ): Promise<EmployeeSalaryTermsDto[]> {
    return this.salaries.listTerms(employeeId);
  }

  @Put('employees/:employeeId/salary/terms')
  @ApiOperation({
    summary: "Set an employee's fixed monthly salary from a month on",
    description:
      'Replaces the version of the same month; 0 = not paid from that month. 422 SALARY_MONTH_PAID.',
  })
  @ApiOkResponse({ type: EmployeeSalaryTermsDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  @ApiUnprocessableEntityResponse({ type: ErrorResponseDto })
  setSalary(
    @Param('employeeId', ParseUUIDPipe) employeeId: string,
    @Body() dto: SetEmployeeSalaryDto,
    @CurrentActor() actor: Actor,
  ): Promise<EmployeeSalaryTermsDto> {
    return this.salaries.setSalary(employeeId, dto, actor);
  }

  @Get('employees/:employeeId/salary/statement')
  @ApiOperation({
    summary: "An employee's salary statement for a month",
    description: "The month's fixed salary, its payments, and what remains.",
  })
  @ApiOkResponse({ type: EmployeeSalaryStatementDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  statement(
    @Param('employeeId', ParseUUIDPipe) employeeId: string,
    @Query() query: SalaryMonthQueryDto,
  ): Promise<EmployeeSalaryStatementDto> {
    return this.salaries.statement(employeeId, query.month);
  }

  @Post('employees/:employeeId/salary/payments')
  @ApiOperation({
    summary: 'Record a salary payment (also a clinic expense)',
    description:
      'Any amount > 0 for a month up to the current one: advances and partial payments allowed. 422 DATE_OUT_OF_RANGE (future month), EXPENSE_DATE_IN_FUTURE.',
  })
  @ApiCreatedResponse({ type: EmployeeSalaryPaymentDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  @ApiUnprocessableEntityResponse({ type: ErrorResponseDto })
  recordPayment(
    @Param('employeeId', ParseUUIDPipe) employeeId: string,
    @Body() dto: RecordSalaryPaymentDto,
    @CurrentActor() actor: Actor,
  ): Promise<EmployeeSalaryPaymentDto> {
    return this.salaries.recordPayment(employeeId, dto, actor);
  }

  @Post('employee-salaries/payments/:id/void')
  @ApiOperation({ summary: 'Void a salary payment (and its expense)' })
  @ApiCreatedResponse({ type: EmployeeSalaryPaymentDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  @ApiUnprocessableEntityResponse({
    type: ErrorResponseDto,
    description: 'PAYOUT_VOIDED',
  })
  voidPayment(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SalaryReasonDto,
    @CurrentActor() actor: Actor,
  ): Promise<EmployeeSalaryPaymentDto> {
    return this.salaries.voidPayment(id, dto.reason, actor);
  }
}
