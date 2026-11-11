import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserRole } from '../../common/enums/user-role.enum.js';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-request.interface.js';
import { Doctor } from './entities/doctor.entity.js';

/**
 * "Own data only" rule for DOCTOR users. A doctor asking for another
 * doctor's data gets 404 (not 403) so existence is not leaked.
 */
@Injectable()
export class DoctorAccessService {
  constructor(
    @InjectRepository(Doctor) private readonly doctors: Repository<Doctor>,
  ) {}

  // The doctor profile id of a DOCTOR user, or null for other roles.
  async scopeFor(user: AuthenticatedUser): Promise<string | null> {
    if (user.role !== UserRole.DOCTOR) return null;
    const doctor = await this.doctors.findOne({
      where: { userId: user.id },
      select: { id: true },
    });
    // A DOCTOR account without a profile can see nothing.
    if (!doctor) throw new NotFoundException('Doctor not found');
    return doctor.id;
  }

  async assertCanAccessDoctor(
    user: AuthenticatedUser,
    doctorId: string,
  ): Promise<void> {
    const ownId = await this.scopeFor(user);
    if (ownId !== null && ownId !== doctorId) {
      throw new NotFoundException('Doctor not found');
    }
  }
}
