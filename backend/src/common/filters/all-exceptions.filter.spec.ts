import {
  ArgumentsHost,
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { QueryFailedError } from 'typeorm';
import { InvalidPhoneNumberError } from '../errors/invalid-phone-number.error.js';
import { AllExceptionsFilter } from './all-exceptions.filter.js';

function mockHost() {
  const response = { status: vi.fn().mockReturnThis(), json: vi.fn() };
  const request = { originalUrl: '/api/v1/things/1', url: '/things/1' };
  const host = {
    switchToHttp: () => ({
      getResponse: () => response,
      getRequest: () => request,
    }),
  } as unknown as ArgumentsHost;
  return { host, response };
}

function pgError(code: string, constraint?: string): QueryFailedError {
  return new QueryFailedError('INSERT ...', [], {
    code,
    constraint,
  } as unknown as Error);
}

describe('AllExceptionsFilter', () => {
  const filter = new AllExceptionsFilter();

  it('returns the consistent error shape for HttpExceptions', () => {
    const { host, response } = mockHost();
    filter.catch(new NotFoundException('Patient not found'), host);

    expect(response.status).toHaveBeenCalledWith(404);
    expect(response.json).toHaveBeenCalledWith({
      statusCode: 404,
      error: 'Not Found',
      message: 'Patient not found',
      path: '/api/v1/things/1',
      timestamp: expect.any(String),
    });
  });

  it('keeps details passed in the exception body', () => {
    const { host, response } = mockHost();
    filter.catch(
      new ConflictException({
        message: 'A patient with this phone number already exists',
        details: { patientId: 'abc' },
      }),
      host,
    );

    expect(response.status).toHaveBeenCalledWith(409);
    expect(response.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: 'Conflict',
        message: 'A patient with this phone number already exists',
        details: { patientId: 'abc' },
      }),
    );
  });

  it('turns a list of messages into a single message plus details', () => {
    const { host, response } = mockHost();
    filter.catch(new BadRequestException(['a is required', 'b is bad']), host);

    expect(response.json).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'a is required; b is bad',
        details: ['a is required', 'b is bad'],
      }),
    );
  });

  it('maps an unhandled unique violation to 409', () => {
    const { host, response } = mockHost();
    filter.catch(pgError('23505', 'uq_users_email'), host);

    expect(response.status).toHaveBeenCalledWith(409);
    expect(response.json).toHaveBeenCalledWith(
      expect.objectContaining({ details: { constraint: 'uq_users_email' } }),
    );
  });

  it('maps a check violation to 400', () => {
    const { host, response } = mockHost();
    filter.catch(pgError('23514', 'chk_x'), host);

    expect(response.status).toHaveBeenCalledWith(400);
  });

  it('maps an invalid phone number to 400 with a phone field error', () => {
    const { host, response } = mockHost();
    filter.catch(new InvalidPhoneNumberError('123'), host);

    expect(response.status).toHaveBeenCalledWith(400);
    expect(response.json).toHaveBeenCalledWith(
      expect.objectContaining({
        details: [{ field: 'phone', errors: [expect.any(String)] }],
      }),
    );
  });

  it('hides unknown errors behind a generic 500', () => {
    const { host, response } = mockHost();
    filter.catch(new Error('connection string with secrets'), host);

    expect(response.status).toHaveBeenCalledWith(500);
    expect(response.json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 500,
        error: 'Internal Server Error',
        message: 'Something went wrong, please try again later',
      }),
    );
  });
});
